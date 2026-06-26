// functions/coordination-detect/index.ts — inferred coordination signals (cron, service role).
//
// detect_coordination() (0007_detection.sql) does the statistical work: temporal bursts, identical
// hashtag sets, shared reel audio, and author-network overlap → coordination_signal rows + a
// coordinated-attack alert when a signal is strong. This function is the thin LLM trigger that adds
// a one-line, human-readable summary onto fresh signals so the war-room reads them at a glance.
//
// Principle V (NON-NEGOTIABLE): coordination is ALWAYS inferred, NEVER asserted as proven. The
// summary is stored under evidence.summary and explicitly prefixed "Inferred"; the numeric score and
// the raw evidence stay on the row. A human sits between this signal and any action.

import { serviceClient } from "../../shared/db.ts";
import { chat } from "../../shared/llm.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("coordination-detect");

const SUMMARY_LIMIT = Number(Deno.env.get("COORD_SUMMARY_LIMIT") ?? "20");
const SUMMARY_SYS =
  "You write ONE plain-English line (<=20 words) describing an INFERRED coordination pattern among " +
  "opposition accounts for an analyst. Describe the pattern as a signal, never as proof. No preamble.";

function describeSignal(
  signalType: string,
  evidence: Record<string, unknown>,
  accounts: number,
): string {
  switch (signalType) {
    case "shared_audio":
      return `${accounts} accounts reused the same reel audio (${
        evidence.audio_id ?? "?"
      }) within the window.`;
    case "content":
      return `${accounts} accounts pushed the identical hashtag ${
        evidence.hashtag ?? "?"
      } within the window.`;
    case "temporal":
      return `${accounts} accounts posted inside a single tight ${
        evidence.window ?? ""
      } sub-window.`;
    case "author_network":
      return `A single hashed commenter hit ${
        evidence.targets ?? accounts
      } opposition targets in the window.`;
    default:
      return `${accounts} accounts showed a synchrony pattern (${signalType}).`;
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  const { error: detErr } = await db.rpc("detect_coordination");
  if (detErr) {
    log.error("detect_coordination failed", { err: detErr.message });
    return errorResponse(500, "coordination_failed", "detect_coordination failed.");
  }

  // Annotate recent signals that don't yet carry a human summary.
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: signals, error: sErr } = await db.from("coordination_signal")
    .select("id, tenant_id, signal_type, score, account_ids, evidence")
    .gte("detected_at", since)
    .order("detected_at", { ascending: false })
    .limit(SUMMARY_LIMIT);
  if (sErr) {
    log.error("coordination_signal fetch failed", { err: sErr.message });
    return errorResponse(500, "coordination_failed", "Could not load coordination signals.");
  }

  let summarized = 0;
  for (const s of signals ?? []) {
    const evidence = (s.evidence ?? {}) as Record<string, unknown>;
    if (typeof evidence.summary === "string") continue; // already annotated.
    const accounts = Array.isArray(s.account_ids) ? s.account_ids.length : 0;
    const factual = describeSignal(s.signal_type, evidence, accounts);
    try {
      const raw = await chat(
        `Coordination signal (${s.signal_type}, score ${
          Number(s.score).toFixed(2)
        }): ${factual}\n` +
          `Rewrite as one analyst-facing line.`,
        { tier: "nuanced", system: SUMMARY_SYS },
      );
      const one = raw.replace(/[`*"]/g, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ??
        factual;
      // Honest framing is enforced here regardless of what the model returns (Principle V).
      const summary = `Inferred: ${one}`;
      const { error: upErr } = await db.from("coordination_signal")
        .update({ evidence: { ...evidence, summary, inferred: true } })
        .eq("id", s.id).eq("tenant_id", s.tenant_id);
      if (upErr) {
        log.warn("signal summary update failed", { id: s.id, err: upErr.message });
        continue;
      }
      summarized += 1;
    } catch (e) {
      log.warn("signal summarization failed", { id: s.id, err: String(e) });
    }
  }

  log.info("coordination detected + summarized", { signals: (signals ?? []).length, summarized });
  return jsonResponse({ recent_signals: (signals ?? []).length, summarized });
});
