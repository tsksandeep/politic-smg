// Static configuration + storage keys for the node client.
// No secrets live here. Node tokens and operator-entered values live ONLY in
// chrome.storage.local (Principle IV: the node holds no tenant data beyond its lease,
// and never persists credentials of any kind).

/** Instagram web app id — the proven value from the reference capturer. */
export const IG_APP_ID = "936619743392459";

export const IG_ORIGIN = "https://www.instagram.com";

/** Public, logged-out web endpoints (same path set proven in scrape_profile.py). */
export const IG = {
  webProfileInfo: (handle: string) =>
    `/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
  feed: (uid: string, count = 30, maxId?: string) =>
    `/api/v1/feed/user/${uid}/?count=${count}` +
    (maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""),
  mediaInfo: (mediaId: string) => `/api/v1/media/${mediaId}/info/`,
  mediaComments: (mediaId: string) =>
    `/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`,
  permalink: (shortcode: string) => `${IG_ORIGIN}/p/${shortcode}/`,
  profileUrl: (handle: string) => `${IG_ORIGIN}/${encodeURIComponent(handle)}/`,
};

/** chrome.storage.local keys. */
export const KEY = {
  coordinatorUrl: "coordinatorUrl",
  nodeToken: "nodeToken",
  nodeId: "nodeId",
  tenantId: "tenantId",
  label: "label",
  rate: "rate", // { max_requests_per_day, min_interval_ms, jitter_ms }
  backoffUntil: "backoffUntil", // epoch ms; loop is paused until then
  daily: "daily", // { date: "YYYY-MM-DD", count: number }
  stats: "stats", // { captures: number, lastError: string|null, lastCaptureAt: string|null }
  nodeStatus: "nodeStatus", // "active" | "quarantined"
  ipStatus: "ipStatus", // "healthy" | "throttled" | "blocked"
} as const;

/** Conservative defaults, overridden by the coordinator's /node-register + /work-lease rate. */
export const DEFAULT_RATE = {
  max_requests_per_day: 100,
  min_interval_ms: 600,
  jitter_ms: 400,
};

/** How many feed pages to pull per account capture. Kept tiny: the node stays light and
 *  rapid-response only needs the newest posts (see README "Fit for rapid-response"). */
export const ACCOUNT_FEED_PAGES = 2;

/** Warm-up retry budget. The first guest XHR is 401 on a cold session; a *reload* (navigation)
 *  warms it to 200. If we exhaust this without a 200, the IP is treated as burned. */
export const WARM_MAX_ATTEMPTS = 5;
export const WARM_RELOAD_WAIT_MS = 2500;

/** Background loop cadence (a chrome.alarm fires this often; each fire runs one lease cycle). */
export const LOOP_ALARM_NAME = "op-node-loop";
export const LOOP_PERIOD_MIN = 1;

/** Long back-off applied when the residential IP is judged burned (persistent 401). */
export const IP_BURNED_BACKOFF_MS = 45 * 60 * 1000;
