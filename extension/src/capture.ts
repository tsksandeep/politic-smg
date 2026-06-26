// capture.ts — the warm-guest-session Instagram capture, ported from
// backend/scrapers/instagram/scrape_profile.py into MV3.
//
// =============================================================================
// HOW GUEST-SESSION ISOLATION IS ACHIEVED IN MV3 (Principle II + IV)
// =============================================================================
// The single most important safety property: the node must NEVER touch, read, or reuse the
// operator's logged-in Instagram session. We achieve this with a *dedicated incognito browser
// context*:
//
//   1. All capture happens inside a dedicated INCOGNITO window that this node creates and reuses
//      (created minimized + unfocused so it never disrupts the operator). An incognito context
//      has its OWN ephemeral cookie store, completely separate from the operator's normal-profile
//      cookie jar where any Instagram login lives. The node therefore *cannot* send or even read
//      the operator's IG session cookies — they do not exist in the incognito store.
//
//   2. The capture code runs as an injected function on the incognito instagram.com tab via
//      chrome.scripting.executeScript. A same-origin `fetch()` from that tab uses ONLY the
//      incognito guest cookies (a logged-out session, warmed by reload), and is same-origin so it
//      bypasses CORS without any host trickery.
//
//   3. Before AND after every capture we purge instagram.com cookies from the incognito store
//      (chrome.cookies, scoped to that store id) so each capture starts from a cold guest jar and
//      leaves nothing behind. Incognito cookies are discarded by the browser when the window
//      closes anyway — belt and suspenders.
//
//   4. The node never calls a login/auth endpoint, never reads chrome.cookies for the NORMAL
//      store, and never stores credentials. host_permissions cover only instagram.com + the
//      coordinator origin.
//
// Why this protects the operator: even if the operator is logged into Instagram in their normal
// browsing, that session is in a different cookie store the node has no reason and no code path to
// read. The operator's account is never authenticated-against, rate-limited against, or exposed.
// If the guest IP gets burned, only an anonymous logged-out session is implicated — never the
// operator's identity (Principle IV).
// =============================================================================

import {
  ACCOUNT_FEED_PAGES,
  IG,
  IG_APP_ID,
  IG_ORIGIN,
  WARM_MAX_ATTEMPTS,
  WARM_RELOAD_WAIT_MS,
} from "./config";
import {
  AccountField,
  CaptureAccountResult,
  CaptureOutcome,
  CommentField,
  PostField,
} from "./types";

// --- guest-context lifecycle ------------------------------------------------

let guestWindowId: number | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Create (once) or reuse the dedicated minimized, unfocused incognito window. */
async function ensureGuestWindow(): Promise<number> {
  if (guestWindowId !== null) {
    try {
      await chrome.windows.get(guestWindowId);
      return guestWindowId;
    } catch {
      guestWindowId = null; // it was closed; recreate
    }
  }
  const win = await chrome.windows.create({
    incognito: true,
    focused: false,
    state: "minimized",
    url: "about:blank",
  });
  if (!win?.id) throw new Error("could_not_open_guest_window");
  guestWindowId = win.id;
  return guestWindowId;
}

/** Open a tab in the guest window, navigated to `url`, and wait for it to finish loading. */
async function openGuestTab(url: string): Promise<chrome.tabs.Tab> {
  const windowId = await ensureGuestWindow();
  const tab = await chrome.tabs.create({ windowId, url, active: false });
  await waitForComplete(tab.id!);
  return tab;
}

function waitForComplete(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab_load_timeout"));
    }, timeoutMs);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function closeTab(tabId?: number): Promise<void> {
  if (tabId == null) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
}

/** Find the cookie store backing a given (incognito) tab. */
async function storeIdForTab(tabId: number): Promise<string | null> {
  const stores = await chrome.cookies.getAllCookieStores();
  for (const s of stores) {
    if (s.tabIds?.includes(tabId)) return s.id;
  }
  return null;
}

/** Purge instagram.com cookies from the guest store. Cold jar before, clean slate after. */
async function purgeInstagramCookies(tabId: number): Promise<void> {
  const storeId = await storeIdForTab(tabId);
  if (!storeId) return;
  const cookies = await chrome.cookies.getAll({ storeId, domain: "instagram.com" });
  await Promise.all(
    cookies.map((c) => {
      const url = `https://${c.domain.replace(/^\./, "")}${c.path}`;
      return chrome.cookies
        .remove({ url, name: c.name, storeId })
        .catch(() => undefined);
    })
  );
}

// --- injected (in-page) functions -------------------------------------------
// These run inside the incognito instagram.com tab (isolated content-script world). They must be
// fully self-contained — executeScript serialises them, so no outer closures are available.

/** Probe one web_profile_info call; returns the HTTP status. Used for reload-based warm-up. */
function probeFn(handle: string, appId: string): Promise<number> {
  return fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, {
    headers: { "x-ig-app-id": appId },
    credentials: "include",
  })
    .then((r) => r.status)
    .catch(() => -1);
}

/** Runs only after warm: profile metadata + paginate the user feed. Returns normalised JSON. */
function harvestAccountFn(
  handle: string,
  appId: string,
  maxPages: number,
  origin: string
): Promise<{ account: any; posts: any[] } | null> {
  const H = { "x-ig-app-id": appId } as Record<string, string>;
  const opt: RequestInit = { headers: H, credentials: "include" };
  const toIso = (sec: any) =>
    typeof sec === "number" ? new Date(sec * 1000).toISOString() : null;

  const extractAudioId = (it: any): string | null => {
    const cm = it.clips_metadata;
    if (!cm) return null;
    return (
      cm?.music_info?.music_asset_info?.audio_cluster_id ??
      cm?.original_sound_info?.audio_asset_id ??
      cm?.original_sound_info?.audio_cluster_id ??
      null
    );
  };
  const mediaUrlOf = (it: any): string | null => {
    if (it.media_type === 2 && it.video_versions?.length) return it.video_versions[0].url;
    return it.image_versions2?.candidates?.[0]?.url ?? null;
  };

  return (async () => {
    let user: any = null;
    try {
      const r = await fetch(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
        opt
      );
      if (r.status === 200) user = (await r.json())?.data?.user;
    } catch {
      /* fall through */
    }
    if (!user) return null;

    const account = {
      external_id: String(user.id),
      followers: user.edge_followed_by?.count ?? null,
      following: user.edge_follow?.count ?? null,
      posts_count: user.edge_owner_to_timeline_media?.count ?? null,
      is_private: !!user.is_private,
    };

    // Private accounts are out of bounds (Principle II): report and capture nothing.
    if (account.is_private) return { account, posts: [] };

    const posts: any[] = [];
    let maxId: string | null = null;
    for (let p = 0; p < maxPages; p++) {
      let url = `/api/v1/feed/user/${user.id}/?count=30`;
      if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;
      let j: any;
      try {
        const r = await fetch(url, opt);
        if (r.status !== 200) break;
        j = await r.json();
      } catch {
        break;
      }
      for (const it of j.items || []) {
        posts.push({
          shortcode: it.code,
          is_video: it.media_type === 2,
          caption: it.caption?.text ?? null,
          audio_id: extractAudioId(it),
          taken_at: toIso(it.taken_at),
          permalink: `${origin}/p/${it.code}/`,
          like_count: it.like_count ?? null,
          comment_count: it.comment_count ?? null,
          view_count: it.play_count ?? it.view_count ?? null,
          media_url: mediaUrlOf(it),
        });
      }
      if (!j.more_available || !j.next_max_id) break;
      maxId = j.next_max_id;
      await new Promise((res) => setTimeout(res, 600)); // polite pacing between pages
    }
    return { account, posts };
  })();
}

/** Single-post info: like/comment/view counts + metadata, for velocity re-sampling. */
function harvestPostFn(
  mediaId: string,
  shortcode: string,
  appId: string,
  origin: string
): Promise<any | null> {
  const opt: RequestInit = { headers: { "x-ig-app-id": appId }, credentials: "include" };
  const toIso = (sec: any) =>
    typeof sec === "number" ? new Date(sec * 1000).toISOString() : null;
  return (async () => {
    let it: any = null;
    try {
      const r = await fetch(`/api/v1/media/${mediaId}/info/`, opt);
      if (r.status === 200) it = (await r.json())?.items?.[0];
    } catch {
      return null;
    }
    if (!it) return null;
    const mediaUrl =
      it.media_type === 2 && it.video_versions?.length
        ? it.video_versions[0].url
        : it.image_versions2?.candidates?.[0]?.url ?? null;
    return {
      shortcode: it.code ?? shortcode,
      is_video: it.media_type === 2,
      caption: it.caption?.text ?? null,
      audio_id:
        it.clips_metadata?.music_info?.music_asset_info?.audio_cluster_id ??
        it.clips_metadata?.original_sound_info?.audio_asset_id ??
        null,
      taken_at: toIso(it.taken_at),
      permalink: `${origin}/p/${it.code ?? shortcode}/`,
      like_count: it.like_count ?? null,
      comment_count: it.comment_count ?? null,
      view_count: it.play_count ?? it.view_count ?? null,
      media_url: mediaUrl,
    };
  })();
}

/** Public comments for one media. Raw author handles are sent ONLY for server-side HMAC. */
function harvestCommentsFn(mediaId: string, appId: string): Promise<any[]> {
  const opt: RequestInit = { headers: { "x-ig-app-id": appId }, credentials: "include" };
  const toIso = (sec: any) =>
    typeof sec === "number" ? new Date(sec * 1000).toISOString() : null;
  return (async () => {
    try {
      const r = await fetch(
        `/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`,
        opt
      );
      if (r.status !== 200) return [];
      const j = await r.json();
      return (j.comments || []).map((c: any) => ({
        author_handle: c.user?.username ?? "",
        text: c.text ?? "",
        created_at: toIso(c.created_at ?? c.created_at_utc),
      }));
    } catch {
      return [];
    }
  })();
}

// --- orchestration ----------------------------------------------------------

async function runInTab<A extends any[], R>(
  tabId: number,
  func: (...args: A) => R | Promise<R>,
  args: A
): Promise<R> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED", // same-origin fetch here uses the guest cookie jar of this incognito tab
    func: func as (...a: any[]) => any,
    args,
  });
  return res?.result as R;
}

/**
 * Warm the guest session by reload-retry (the proven path): cold first XHR is 401; a *navigation*
 * reload re-establishes the guest session -> 200. A plain wait does NOT warm it.
 * Returns true once warm; false if the budget is exhausted (-> IP treated as burned).
 */
async function warm(tabId: number, handle: string): Promise<boolean> {
  for (let i = 0; i < WARM_MAX_ATTEMPTS; i++) {
    const status = await runInTab(tabId, probeFn, [handle, IG_APP_ID]);
    if (status === 200) return true;
    try {
      await chrome.tabs.reload(tabId);
      await waitForComplete(tabId);
    } catch {
      /* ignore */
    }
    await sleep(WARM_RELOAD_WAIT_MS);
  }
  return false;
}

/** Convert an Instagram shortcode to its numeric media id (base64, IG alphabet). */
export function shortcodeToMediaId(shortcode: string): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = 0n;
  for (const ch of shortcode) {
    const v = ALPHABET.indexOf(ch);
    if (v === -1) break;
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

/**
 * captureAccount(handle) -> profile + recent posts.
 * Opens an isolated guest tab, warms it, harvests, then closes + purges. Polite pacing throughout.
 */
export async function captureAccount(
  handle: string
): Promise<CaptureOutcome<CaptureAccountResult>> {
  let tabId: number | undefined;
  try {
    const tab = await openGuestTab(IG.profileUrl(handle));
    tabId = tab.id!;
    await purgeInstagramCookies(tabId); // start cold; then the warm reload builds a fresh guest jar
    await chrome.tabs.reload(tabId);
    await waitForComplete(tabId);

    if (!(await warm(tabId, handle))) {
      return { ok: false, ipBurned: true, error: "persistent_401_ip_burned" };
    }
    const data = await runInTab(tabId, harvestAccountFn, [
      handle,
      IG_APP_ID,
      ACCOUNT_FEED_PAGES,
      IG_ORIGIN,
    ]);
    if (!data) return { ok: false, error: "no_profile_json" };
    return {
      ok: true,
      data: { account: data.account as AccountField, posts: data.posts as PostField[] },
    };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  } finally {
    if (tabId != null) await purgeInstagramCookies(tabId);
    await closeTab(tabId);
  }
}

/** capturePostMetrics(shortcode) -> a fresh metrics snapshot for velocity re-sampling. */
export async function capturePostMetrics(
  shortcode: string
): Promise<CaptureOutcome<PostField>> {
  let tabId: number | undefined;
  try {
    const tab = await openGuestTab(IG.permalink(shortcode));
    tabId = tab.id!;
    await purgeInstagramCookies(tabId);
    await chrome.tabs.reload(tabId);
    await waitForComplete(tabId);

    // Warm using the same web_profile_info probe (any 200 means the guest session is established).
    if (!(await warmViaReloadOnly(tabId))) {
      return { ok: false, ipBurned: true, error: "persistent_401_ip_burned" };
    }
    const mediaId = shortcodeToMediaId(shortcode);
    const post = await runInTab(tabId, harvestPostFn, [
      mediaId,
      shortcode,
      IG_APP_ID,
      IG_ORIGIN,
    ]);
    if (!post) return { ok: false, error: "no_post_json" };
    return { ok: true, data: post as PostField };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  } finally {
    if (tabId != null) await purgeInstagramCookies(tabId);
    await closeTab(tabId);
  }
}

/** captureComments(shortcode) -> [{author_handle, text, created_at}] (raw -> server hashes). */
export async function captureComments(
  shortcode: string
): Promise<CaptureOutcome<CommentField[]>> {
  let tabId: number | undefined;
  try {
    const tab = await openGuestTab(IG.permalink(shortcode));
    tabId = tab.id!;
    await purgeInstagramCookies(tabId);
    await chrome.tabs.reload(tabId);
    await waitForComplete(tabId);

    if (!(await warmViaReloadOnly(tabId))) {
      return { ok: false, ipBurned: true, error: "persistent_401_ip_burned" };
    }
    const mediaId = shortcodeToMediaId(shortcode);
    const comments = await runInTab(tabId, harvestCommentsFn, [mediaId, IG_APP_ID]);
    return { ok: true, data: (comments ?? []) as CommentField[] };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  } finally {
    if (tabId != null) await purgeInstagramCookies(tabId);
    await closeTab(tabId);
  }
}

/** Warm a media/post page where we have no handle: probe a cheap public endpoint until 200. */
async function warmViaReloadOnly(tabId: number): Promise<boolean> {
  for (let i = 0; i < WARM_MAX_ATTEMPTS; i++) {
    const status = await runInTab(
      tabId,
      (appId: string) =>
        fetch("/api/v1/users/web_profile_info/?username=instagram", {
          headers: { "x-ig-app-id": appId },
          credentials: "include",
        })
          .then((r) => r.status)
          .catch(() => -1),
      [IG_APP_ID]
    );
    if (status === 200) return true;
    try {
      await chrome.tabs.reload(tabId);
      await waitForComplete(tabId);
    } catch {
      /* ignore */
    }
    await sleep(WARM_RELOAD_WAIT_MS);
  }
  return false;
}
