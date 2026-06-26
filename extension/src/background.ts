// background.ts — the node loop (MV3 service worker).
//
// Lifecycle:
//   - On install / options-save: register via /node-register with an enrolment code; store
//     node_token + rate in chrome.storage.local.
//   - Main loop (driven by a chrome.alarm so it survives SW suspension): /work-lease -> for each
//     item capture -> /submit -> /heartbeat. Honour rate.min_interval_ms + jitter; back off on the
//     heartbeat's backoff_ms; treat persistent 401 as "IP burned" -> report ip_status='blocked'
//     and back off (Principle IX graceful degradation).
//
// The node is deliberately "dumb": it holds no analytics, no tenant data beyond the current lease,
// and never reasons about narratives. It captures public data and ships it one-way (Principle IV).

import * as api from "./api";
import {
  captureAccount,
  captureComments,
  capturePostMetrics,
} from "./capture";
import {
  DEFAULT_RATE,
  IP_BURNED_BACKOFF_MS,
  KEY,
  LOOP_ALARM_NAME,
  LOOP_PERIOD_MIN,
} from "./config";
import {
  IpStatus,
  Rate,
  SubmitPayload,
  WorkItem,
} from "./types";

// --- storage helpers --------------------------------------------------------

async function get<T>(key: string, fallback: T): Promise<T> {
  const o = await chrome.storage.local.get(key);
  return (o[key] as T) ?? fallback;
}
async function set(obj: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(obj);
}

interface Daily {
  date: string;
  count: number;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
async function getDaily(): Promise<Daily> {
  const d = await get<Daily>(KEY.daily, { date: today(), count: 0 });
  if (d.date !== today()) return { date: today(), count: 0 };
  return d;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pace one request: min_interval + uniform jitter (Principle IV capped + jittered rates). */
async function pace(rate: Rate): Promise<void> {
  const jitter = Math.floor(Math.random() * Math.max(0, rate.jitter_ms));
  await sleep(rate.min_interval_ms + jitter);
}

// --- registration (called from the options page) ----------------------------

export async function registerNode(
  coordinatorUrl: string,
  enrolmentCode: string,
  label: string
): Promise<void> {
  const res = await api.register(coordinatorUrl, enrolmentCode, label);
  await set({
    [KEY.coordinatorUrl]: coordinatorUrl,
    [KEY.nodeToken]: res.node_token, // tenant-scoped node token; never a user session
    [KEY.nodeId]: res.node_id,
    [KEY.tenantId]: res.tenant_id,
    [KEY.label]: label,
    [KEY.rate]: res.rate ?? DEFAULT_RATE,
    [KEY.nodeStatus]: "active",
    [KEY.ipStatus]: "healthy" as IpStatus,
    [KEY.stats]: { captures: 0, lastError: null, lastCaptureAt: null },
  });
  await ensureAlarm();
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(LOOP_ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(LOOP_ALARM_NAME, {
      periodInMinutes: LOOP_PERIOD_MIN,
      delayInMinutes: 0.1,
    });
  }
}

// --- one capture, dispatched by target kind ---------------------------------

interface CycleAcc {
  ok: number;
  err: number;
  ip: IpStatus;
}

async function captureAndBuild(
  item: WorkItem
): Promise<{ payload?: SubmitPayload; ipBurned?: boolean; error?: string }> {
  const capturedAt = new Date().toISOString();

  if (item.target_kind === "account" && item.handle) {
    const r = await captureAccount(item.handle);
    if (!r.ok || !r.data) return { ipBurned: r.ipBurned, error: r.error };
    return {
      payload: {
        assignment_id: item.assignment_id,
        captured_at: capturedAt,
        account: r.data.account,
        posts: r.data.posts,
      },
    };
  }

  if (item.target_kind === "post_metrics" && item.shortcode) {
    const r = await capturePostMetrics(item.shortcode);
    if (!r.ok || !r.data) return { ipBurned: r.ipBurned, error: r.error };
    return {
      payload: {
        assignment_id: item.assignment_id,
        captured_at: capturedAt,
        post_shortcode: item.shortcode,
        post: r.data,
      },
    };
  }

  if (item.target_kind === "comments" && item.shortcode) {
    const r = await captureComments(item.shortcode);
    if (!r.ok || !r.data) return { ipBurned: r.ipBurned, error: r.error };
    return {
      payload: {
        assignment_id: item.assignment_id,
        captured_at: capturedAt,
        post_shortcode: item.shortcode,
        comments: r.data,
      },
    };
  }

  return { error: `unsupported_or_incomplete_item:${item.target_kind}` };
}

// --- the main loop cycle (one alarm fire) -----------------------------------

let running = false;

async function runCycle(): Promise<void> {
  if (running) return; // never overlap cycles
  running = true;
  try {
    const coordinatorUrl = await get<string>(KEY.coordinatorUrl, "");
    const token = await get<string>(KEY.nodeToken, "");
    if (!coordinatorUrl || !token) return; // not enrolled yet

    // Respect any active back-off (heartbeat backoff or IP-burned back-off).
    const backoffUntil = await get<number>(KEY.backoffUntil, 0);
    if (Date.now() < backoffUntil) return;

    let rate = await get<Rate>(KEY.rate, DEFAULT_RATE);
    const acc: CycleAcc = { ok: 0, err: 0, ip: "healthy" };

    // 1) Lease a small batch.
    let items: WorkItem[] = [];
    try {
      const lease = await api.workLease(coordinatorUrl, token, 10);
      items = lease.items ?? [];
      if (lease.rate) {
        rate = lease.rate;
        await set({ [KEY.rate]: rate });
      }
    } catch (e) {
      await handleCoordinatorError(e);
      // still heartbeat below so the coordinator sees us
    }

    // 2) Process each item, honouring the daily cap + paced/jittered rate.
    for (const item of items) {
      const daily = await getDaily();
      if (daily.count >= rate.max_requests_per_day) break; // daily budget spent

      await pace(rate);

      const built = await captureAndBuild(item);

      // Persistent 401 -> this residential IP is burned. Stop, report blocked, back off long,
      // and let the coordinator re-lease this item to another node (Principle IX).
      if (built.ipBurned) {
        acc.ip = "blocked";
        acc.err += 1;
        await bumpStats({ error: "ip_burned" });
        break;
      }

      if (!built.payload) {
        acc.err += 1;
        await bumpStats({ error: built.error ?? "capture_failed" });
        if (acc.ip === "healthy") acc.ip = "throttled";
        continue;
      }

      try {
        await api.submit(coordinatorUrl, token, built.payload);
        acc.ok += 1;
        await incDaily();
        await bumpStats({ captured: true });
      } catch (e) {
        acc.err += 1;
        await bumpStats({ error: (e as Error)?.message ?? "submit_failed" });
        await handleCoordinatorError(e);
      }
    }

    // 3) Heartbeat (always, whether or not work was leased — FR-015).
    await set({ [KEY.ipStatus]: acc.ip });
    try {
      const hb = await api.heartbeat(coordinatorUrl, token, {
        ok_count: acc.ok,
        error_count: acc.err,
        ip_status: acc.ip,
      });
      await set({ [KEY.nodeStatus]: hb.node_status });

      let backoff = hb.backoff_ms ?? 0;
      if (acc.ip === "blocked") backoff = Math.max(backoff, IP_BURNED_BACKOFF_MS);
      if (hb.node_status === "quarantined") {
        // A quarantined node stops being leased work; back off generously.
        backoff = Math.max(backoff, IP_BURNED_BACKOFF_MS);
      }
      if (backoff > 0) await set({ [KEY.backoffUntil]: Date.now() + backoff });
    } catch (e) {
      await handleCoordinatorError(e);
    }
  } finally {
    running = false;
  }
}

async function incDaily(): Promise<void> {
  const d = await getDaily();
  await set({ [KEY.daily]: { date: d.date, count: d.count + 1 } });
}

async function bumpStats(ev: { captured?: boolean; error?: string }): Promise<void> {
  const s = await get<{
    captures: number;
    lastError: string | null;
    lastCaptureAt: string | null;
  }>(KEY.stats, { captures: 0, lastError: null, lastCaptureAt: null });
  if (ev.captured) {
    s.captures += 1;
    s.lastCaptureAt = new Date().toISOString();
  }
  if (ev.error) s.lastError = ev.error;
  await set({ [KEY.stats]: s });
}

/** Revoked / quarantined coordinator responses pause the node. */
async function handleCoordinatorError(e: unknown): Promise<void> {
  if (e instanceof api.CoordinatorError) {
    if (e.code === "node_revoked" || e.status === 403) {
      await set({
        [KEY.nodeStatus]: "quarantined",
        [KEY.backoffUntil]: Date.now() + IP_BURNED_BACKOFF_MS,
      });
    }
    await bumpStats({ error: e.code });
  } else {
    await bumpStats({ error: (e as Error)?.message ?? "network_error" });
  }
}

// --- wiring -----------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOOP_ALARM_NAME) void runCycle();
});

// Messages from the options page (register, manual run, status read).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "register") {
        await registerNode(msg.coordinatorUrl, msg.enrolmentCode, msg.label);
        sendResponse({ ok: true });
      } else if (msg?.type === "runNow") {
        void runCycle();
        sendResponse({ ok: true });
      } else if (msg?.type === "status") {
        const all = await chrome.storage.local.get(null);
        // Never expose the node token to any UI surface.
        delete all[KEY.nodeToken];
        sendResponse({ ok: true, status: all });
      } else {
        sendResponse({ ok: false, error: "unknown_message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error)?.message ?? String(e) });
    }
  })();
  return true; // async response
});
