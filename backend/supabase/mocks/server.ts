// mocks/server.ts — a single local stand-in for every external API the system calls.
//
// Run it (see Makefile `make mock`) and point the *_BASE / *_URL env vars in .env.local at it.
// The Edge Functions then exercise their REAL code paths against deterministic fakes, so the
// whole pipeline (OAuth consent → backfill → analyze → embed → detect → alert) runs locally with
// no Meta/Google/OpenRouter/Gemini credentials. Prod just leaves those env vars unset.
//
// Covers:
//   Meta:    GET /meta/dialog/oauth (consent → redirect), GET /meta/graph/oauth/access_token
//            (code + fb_exchange_token), GET /meta/graph/me/accounts, GET /meta/graph/<ig>/media
//   Google:  GET /google/auth (consent → redirect), POST /google/token,
//            GET /youtube/v3/{channels,playlistItems,commentThreads}
//   AI:      POST /openrouter/v1/chat/completions, POST /vertex/.../<model>:predict (embeddings)

const PORT = Number(Deno.env.get("MOCK_PORT") ?? "9100");
const EMBED_DIM = 768;
const COMMENT_COUNT = Number(Deno.env.get("MOCK_COMMENT_COUNT") ?? "30"); // > min_volume (25)

const HOSTILE_LEXICON = [
  "corrupt",
  "liar",
  "fail",
  "resign",
  "traitor",
  "shame",
  "fraud",
  "worst",
  "cheat",
  "betray",
  "useless",
  "scam",
  "broken promise",
  "loot",
  "fake",
];
const POSITIVE_LEXICON = ["great", "love", "support", "best", "proud", "thank"];

// ---- Deterministic synthetic data -------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A coordinated hostile burst: distinct commenters, same anti-party theme. */
function hostileComments(n: number): { text: string; author: string; ts: string }[] {
  const templates = [
    "This party is totally corrupt, they betrayed us",
    "Broken promise after broken promise, shame on these liars",
    "Time to resign, you cheated the people, total fraud",
    "Worst leaders ever, they only loot and scam us",
    "Fake promises, useless governance, we will not forget",
  ];
  const out: { text: string; author: string; ts: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      text: `${templates[i % templates.length]} (#${i + 1})`,
      author: `commenter_${i + 1}`,
      ts: new Date(Date.now() - i * 30_000).toISOString(),
    });
  }
  return out;
}

/** Theme-clustered unit embedding: hostile texts share a dominant axis so they cluster into one
 * narrative (cosine distance well under run_detection's 0.25 threshold); positive/neutral land on
 * separate axes. Tiny text-seeded noise keeps vectors distinct without breaking the cluster. */
function embedFor(text: string): number[] {
  const lower = text.toLowerCase();
  const hostile = HOSTILE_LEXICON.some((w) => lower.includes(w));
  const positive = !hostile && POSITIVE_LEXICON.some((w) => lower.includes(w));
  const axis = hostile ? 0 : positive ? 1 : 2;
  const v = new Array(EMBED_DIM).fill(0);
  v[axis] = 1;
  let h = hashStr(text);
  for (let i = 0; i < 8; i++) {
    h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff;
    v[3 + i] = (h % 1000) / 1000 - 0.5; // ±0.5 noise, dims 3..10
    v[3 + i] *= 0.04;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function classify(text: string): { sentiment: string; confidence: number; language: string } {
  const lower = text.toLowerCase();
  const hostile = HOSTILE_LEXICON.some((w) => lower.includes(w));
  const positive = !hostile && POSITIVE_LEXICON.some((w) => lower.includes(w));
  // crude language guess: any Tamil block char → ta; presence of both → mixed.
  const hasTamil = /[஀-௿]/.test(text);
  const hasLatin = /[a-z]/i.test(text);
  const language = hasTamil && hasLatin ? "mixed" : hasTamil ? "ta" : "en";
  if (hostile) return { sentiment: "hostile", confidence: 0.92, language };
  if (positive) return { sentiment: "positive", confidence: 0.88, language };
  return { sentiment: "neutral", confidence: 0.7, language };
}

// ---- Helpers --------------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function redirectBack(url: URL, code: string): Response {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const sep = redirectUri.includes("?") ? "&" : "?";
  const loc = `${redirectUri}${sep}code=${code}&state=${encodeURIComponent(state)}`;
  return new Response(null, { status: 302, headers: { Location: loc } });
}

// ---- Router ---------------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // --- Meta consent dialog → bounce straight back to the redirect_uri with a code ---
  if (path === "/meta/dialog/oauth") return redirectBack(url, "mock_ig_code");
  if (path === "/google/auth") return redirectBack(url, "mock_yt_code");

  // --- Meta Graph token exchange (auth code) AND refresh (fb_exchange_token) ---
  if (path === "/meta/graph/oauth/access_token") {
    return json({
      access_token: "mock_ig_token_" + crypto.randomUUID(),
      token_type: "bearer",
      expires_in: 5184000,
    });
  }
  // --- Google token exchange ---
  if (path === "/google/token") {
    return json({
      access_token: "mock_yt_token_" + crypto.randomUUID(),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "mock_yt_refresh",
    });
  }

  // --- Meta: resolve the connected IG Business account ---
  if (path === "/meta/graph/me/accounts") {
    return json({
      data: [{ id: "fb_page_mock_1", instagram_business_account: { id: "ig_biz_mock_1" } }],
    });
  }

  // --- Meta: media (posts) + their comments for the last 30 days ---
  if (path.startsWith("/meta/graph/") && path.endsWith("/media")) {
    const comments = hostileComments(COMMENT_COUNT).map((c) => ({
      text: c.text,
      from: { id: c.author, username: c.author },
      timestamp: c.ts,
    }));
    return json({
      data: [{
        id: "ig_post_mock_1",
        permalink: "https://instagram.com/p/mock1",
        timestamp: new Date(Date.now() - 3600_000).toISOString(),
        comments: { data: comments },
      }],
    });
  }

  // --- YouTube Data API ---
  if (path === "/youtube/v3/channels") {
    if (url.searchParams.get("mine") === "true") {
      return json({ items: [{ id: "yt_channel_mock_1" }] });
    }
    return json({
      items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_mock_uploads" } } }],
    });
  }
  if (path === "/youtube/v3/playlistItems") {
    return json({
      items: [{
        contentDetails: {
          videoId: "yt_vid_mock_1",
          videoPublishedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      }],
    });
  }
  if (path === "/youtube/v3/commentThreads") {
    const items = hostileComments(COMMENT_COUNT).map((c) => ({
      snippet: {
        topLevelComment: {
          snippet: {
            authorChannelId: { value: "ytc_" + c.author },
            authorDisplayName: c.author,
            textOriginal: c.text,
            publishedAt: c.ts,
          },
        },
      },
    }));
    return json({ items });
  }

  // --- OpenRouter chat completions (classification JSON or free-text summary) ---
  if (path === "/openrouter/v1/chat/completions") {
    const body = await req.json().catch(() => ({}));
    const wantsJson = body?.response_format?.type === "json_object";
    const userMsg = [...(body?.messages ?? [])].reverse().find((m: { role: string }) =>
      m.role === "user"
    );
    const content: string = userMsg?.content ?? "";
    if (wantsJson) {
      return json({ choices: [{ message: { content: JSON.stringify(classify(content)) } }] });
    }
    // Summarization request (detect-narratives): return a short theme label.
    return json({
      choices: [{
        message: { content: "Coordinated attack alleging broken promises and corruption." },
      }],
    });
  }

  // --- Vertex AI embeddings (gemini-embedding-001 :predict) ---
  if (path.startsWith("/vertex/") && path.endsWith(":predict")) {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.instances?.[0]?.content ?? "";
    return json({ predictions: [{ embeddings: { values: embedFor(text) } }] });
  }

  return json({ error: "mock_not_found", path }, 404);
}

console.log(`[mock] external-API mock listening on http://0.0.0.0:${PORT}`);
console.log(
  `[mock] reachable as http://localhost:${PORT} (host) and http://host.docker.internal:${PORT} (containers)`,
);
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
