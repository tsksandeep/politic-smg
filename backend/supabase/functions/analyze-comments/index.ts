// functions/analyze-comments (T024) — classify + embed comments via the pgmq analyze_jobs queue.
// Queue-driven (R4): reconcile any un-embedded comment into analyze_jobs, then claim a batch with a
// visibility timeout. For each claimed comment:
//   Tier-1 (Flash-Lite): sentiment + language + confidence (JSON).
//   If confidence is low, escalate to Tier-2 (Flash) for a second opinion.
//   Embed the body (Gemini embeddings) → store via set_comment_analysis (vector cast in SQL).
//   On success the message is deleted; on failure its visibility is reset so read_ct climbs and the
//   message is auto-moved to analyze_jobs_dlq after ANALYZE_MAX_READS attempts (poison-message cap).
// Every score is stored with its confidence (FR-004 / Principle V).

import { serviceClient } from "../../shared/db.ts";
import { chatJSON } from "../../shared/llm.ts";
import { embed, toVectorLiteral } from "../../shared/embeddings.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("analyze-comments");
const BATCH = Number(Deno.env.get("ANALYZE_BATCH") ?? "100");
const VT = Number(Deno.env.get("ANALYZE_VT_SECONDS") ?? "120");
const MAX_READS = Number(Deno.env.get("ANALYZE_MAX_READS") ?? "5");
const ESCALATE_BELOW = 0.6;

const SYSTEM =
  "You classify a social media comment on a political party's own post. Return strict JSON: " +
  '{"sentiment":"hostile|neutral|positive","confidence":0..1,"language":"ta|en|mixed"}. ' +
  "Hostile = anti-party/abusive/coordinated-attack tone. Account for Tamil-English code-mixing and sarcasm.";

interface Classification {
  sentiment: "hostile" | "neutral" | "positive";
  confidence: number;
  language: string;
}

interface Job {
  msg_id: number;
  comment_id: string;
}

Deno.serve(async () => {
  const db = serviceClient();

  // Catch-all: ensure every un-embedded comment has a queue job (covers all producers + any gaps).
  await db.rpc("reconcile_analyze_queue", { p_limit: 1000 });

  // Claim a batch (over-retry-limit messages are auto-moved to the DLQ inside the RPC).
  const { data: jobs } = await db.rpc("claim_analyze_jobs", {
    p_qty: BATCH,
    p_vt: VT,
    p_max_reads: MAX_READS,
  });

  let processed = 0;
  let failed = 0;
  for (const job of (jobs ?? []) as Job[]) {
    try {
      const { data: c } = await db
        .from("comment")
        .select("id, body, embedding")
        .eq("id", job.comment_id)
        .maybeSingle();

      // Comment gone, empty, or already analyzed (e.g. duplicate enqueue) → ack and move on.
      if (!c || !c.body || c.embedding) {
        await db.rpc("complete_analyze_job", { p_msg_id: job.msg_id });
        continue;
      }

      let cls = await chatJSON<Classification>(c.body, { tier: "bulk", system: SYSTEM });
      if (cls.confidence < ESCALATE_BELOW) {
        cls = await chatJSON<Classification>(c.body, { tier: "nuanced", system: SYSTEM });
      }
      const vec = await embed(c.body);
      await db.rpc("set_comment_analysis", {
        p_id: c.id,
        p_sentiment: cls.sentiment,
        p_confidence: cls.confidence,
        p_language: cls.language,
        p_embedding: toVectorLiteral(vec),
      });
      await db.rpc("complete_analyze_job", { p_msg_id: job.msg_id });
      processed++;
    } catch (e) {
      await db.rpc("fail_analyze_job", { p_msg_id: job.msg_id });
      failed++;
      log.error("analyze failed", { comment: job.comment_id, msg: job.msg_id, error: String(e) });
    }
  }

  log.info("analyze batch done", { processed, failed, claimed: jobs?.length ?? 0 });
  return jsonResponse({ processed, failed });
});
