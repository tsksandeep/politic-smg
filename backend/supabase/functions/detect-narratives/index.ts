// functions/detect-narratives/index.ts — cluster + label opposition narratives (cron, service role).
//
// The clustering, lifecycle, growth, amplifier-graph and emerging-narrative early-warning all run in
// SQL (run_detection() — pgvector similarity work). This function is the thin LLM trigger on top:
// for each freshly-clustered narrative with no human label yet, it pulls a few representative
// captions/comments and asks Tier-2 (Flash, nuanced) for a <=15-word theme label naming the
// claim / framing / target, then derives a stance from the sample's sentiment.
//
// Principle V: the numeric `confidence` set by run_detection (avg comment sentiment confidence) is
// LEFT INTACT — the label is a human-readable descriptor, never a verdict that erases the number.

import { serviceClient } from "../../shared/db.ts";
import { chat } from "../../shared/llm.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("detect-narratives");

const LABEL_LIMIT = Number(Deno.env.get("NARRATIVE_LABEL_LIMIT") ?? "20");
const STANCES = new Set(["opposition_attack", "opposition_promote", "neutral"]);

const LABEL_SYS =
  "You label clusters of an opposition cadre's PUBLIC political posts/comments for an analyst war-room. " +
  "Given a few representative samples, write ONE short label (<=15 words) naming the core CLAIM, its " +
  "FRAMING, and the TARGET. No preamble, no quotes — just the label line.";

// Trim to <=15 words and strip wrapping quotes/markdown the model may add.
function tidyLabel(raw: string): string {
  const line = raw.replace(/[`*]/g, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  const clean = line.replace(/^["'\s]+|["'\s]+$/g, "");
  return clean.split(/\s+/).slice(0, 15).join(" ");
}

// Stance is derived from the sample, honestly: the dominant comment sentiment in the cluster.
// hostile-leaning → the cadre is attacking; positive-leaning → promoting; otherwise neutral.
async function deriveStance(
  db: ReturnType<typeof serviceClient>,
  tenantId: string,
  narrativeId: string,
): Promise<string | null> {
  const { data } = await db.from("comment").select("sentiment")
    .eq("tenant_id", tenantId).eq("narrative_id", narrativeId).not("sentiment", "is", null).limit(
      500,
    );
  if (!data || data.length === 0) return null; // can't tell from the sample → leave default.
  let hostile = 0, positive = 0;
  for (const c of data) {
    if (c.sentiment === "hostile") hostile += 1;
    else if (c.sentiment === "positive") positive += 1;
  }
  if (hostile === 0 && positive === 0) return "neutral";
  if (hostile >= positive) return "opposition_attack";
  return "opposition_promote";
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  // 1) Run the SQL detection brain (clustering + metrics + lifecycle + emerging alerts).
  const { error: detErr } = await db.rpc("run_detection");
  if (detErr) {
    log.error("run_detection failed", { err: detErr.message });
    return errorResponse(500, "detect_failed", "run_detection failed.");
  }

  // 2) Label freshly-formed narratives that have material volume but no theme yet (scoped per row).
  const { data: narratives, error: nErr } = await db.from("narrative")
    .select("id, tenant_id, volume")
    .is("theme_summary", null)
    .gt("volume", 0)
    .order("volume", { ascending: false })
    .limit(LABEL_LIMIT);
  if (nErr) {
    log.error("narrative fetch failed", { err: nErr.message });
    return errorResponse(500, "detect_failed", "Could not load narratives to label.");
  }

  let labeled = 0;
  for (const n of narratives ?? []) {
    try {
      const { data: posts } = await db.from("post").select("caption")
        .eq("tenant_id", n.tenant_id).eq("narrative_id", n.id).not("caption", "is", null).limit(5);
      const { data: comments } = await db.from("comment").select("body")
        .eq("tenant_id", n.tenant_id).eq("narrative_id", n.id).not("body", "is", null).limit(5);

      const samples = [
        ...((posts ?? []).map((p) => p.caption)),
        ...((comments ?? []).map((c) => c.body)),
      ].filter((s): s is string => !!s).map((s) => s.slice(0, 280)).slice(0, 8);
      if (samples.length === 0) continue; // nothing representative (raw text purged) — skip labeling.

      const prompt = `Representative samples from one cluster:\n` +
        samples.map((s, i) => `${i + 1}. ${s}`).join("\n") +
        `\n\nWrite the <=15-word label (claim · framing · target).`;
      const raw = await chat(prompt, { tier: "nuanced", system: LABEL_SYS });
      const label = tidyLabel(raw);
      if (!label) continue;

      let stance = await deriveStance(db, n.tenant_id, n.id);
      if (stance && !STANCES.has(stance)) stance = null;

      const patch: Record<string, unknown> = {
        theme_summary: label,
        last_updated_at: new Date().toISOString(),
      };
      if (stance) patch.stance = stance; // only override when the sample tells us; keep numeric confidence intact.
      const { error: upErr } = await db.from("narrative").update(patch)
        .eq("id", n.id).eq("tenant_id", n.tenant_id);
      if (upErr) {
        log.warn("narrative label update failed", { id: n.id, err: upErr.message });
        continue;
      }
      labeled += 1;
    } catch (e) {
      log.warn("narrative labeling failed", { id: n.id, err: String(e) });
    }
  }

  log.info("narratives detected + labeled", { candidates: (narratives ?? []).length, labeled });
  return jsonResponse({ candidates: (narratives ?? []).length, labeled });
});
