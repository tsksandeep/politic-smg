// functions/enrich/index.ts — drain the pgmq `enrich_jobs` queue (cron, service role).
//
// Thin trigger over SQL: the queue + claim/complete/fail RPCs live in 0004_queues.sql; the vector
// casts live in 0007_detection.sql (set_comment_analysis / set_post_embedding). This function only
// does the work Postgres cannot: call the LLM (two-tier, R5) and the embedder, then hand the
// derived text back to SQL.
//
//   kind='comment' → Tier-1 (bulk) classify {sentiment, confidence, language}; escalate ambiguous
//                    cases (confidence < 0.6) to Tier-2 (nuanced). Embed the body. Write both via
//                    set_comment_analysis. Sentiment ships WITH its confidence (Principle V).
//   kind='post'    → embed caption (+ any media_transcript text) and write via set_post_embedding.
//
// Each message carries its own tenant_id so we stay tenant-scoped even though the service role
// bypasses RLS (Principle I — every query is additionally filtered by tenant_id). complete_job on
// success; fail_job on error (read_ct climbs toward the DLQ cap on the next claim).

import { serviceClient } from "../../shared/db.ts";
import { chatJSON } from "../../shared/llm.ts";
import { embed, toVectorLiteral } from "../../shared/embeddings.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("enrich");

const BATCH = Number(Deno.env.get("ENRICH_BATCH") ?? "50");
const VT = Number(Deno.env.get("ENRICH_VT") ?? "60"); // visibility timeout (s)
const MAX_READS = Number(Deno.env.get("ENRICH_MAX_READS") ?? "5"); // → DLQ past this

interface EnrichJob {
  tenant_id: string;
  kind: "comment" | "post";
  id: string;
}
interface ClaimRow {
  msg_id: number;
  message: EnrichJob;
}
interface CommentClass {
  sentiment: "hostile" | "neutral" | "positive";
  confidence: number;
  language: "ta" | "en" | "mixed";
}

const SENTIMENTS = new Set(["hostile", "neutral", "positive"]);
const LANGS = new Set(["ta", "en", "mixed"]);
const CLASSIFY_SYS =
  "You are a bulk classifier of PUBLIC political comments (Tamil / English / mixed) directed at an " +
  "opposition account. Judge the comment's sentiment toward its target. Return STRICT JSON only.";

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalize(r: Partial<CommentClass>): CommentClass {
  const sentiment = SENTIMENTS.has(r.sentiment as string)
    ? r.sentiment as CommentClass["sentiment"]
    : "neutral";
  const language = LANGS.has(r.language as string) ? r.language as CommentClass["language"] : "en";
  return { sentiment, confidence: clamp01(r.confidence), language };
}

// Two-tier (R5): cheap bulk pass; escalate only ambiguous (low-confidence) cases to the nuanced tier.
async function classifyComment(body: string): Promise<CommentClass> {
  const prompt = `Classify this comment toward its target.\n` +
    `Return JSON: {"sentiment":"hostile|neutral|positive","confidence":0..1,"language":"ta|en|mixed"}\n\n` +
    `Comment:\n"""${body.slice(0, 2000)}"""`;
  let r = normalize(await chatJSON<CommentClass>(prompt, { tier: "bulk", system: CLASSIFY_SYS }));
  if (r.confidence < 0.6) {
    try {
      const n = normalize(
        await chatJSON<CommentClass>(prompt, { tier: "nuanced", system: CLASSIFY_SYS }),
      );
      // Keep the nuanced verdict (it is the higher-quality model).
      r = n;
    } catch (e) {
      log.warn("nuanced escalation failed; keeping bulk verdict", { err: String(e) });
    }
  }
  return r;
}

async function processComment(db: ReturnType<typeof serviceClient>, job: EnrichJob): Promise<void> {
  const { data: c } = await db.from("comment").select("body").eq("id", job.id).eq(
    "tenant_id",
    job.tenant_id,
  )
    .maybeSingle();
  const body = (c?.body ?? "").trim();
  if (!body) return; // nothing to enrich (purged or empty) — treat as done.
  const cls = await classifyComment(body);
  const vec = toVectorLiteral(await embed(body));
  const { error } = await db.rpc("set_comment_analysis", {
    p_id: job.id,
    p_sentiment: cls.sentiment,
    p_confidence: cls.confidence,
    p_language: cls.language,
    p_embedding: vec,
  });
  if (error) throw new Error(`set_comment_analysis: ${error.message}`);
}

async function processPost(db: ReturnType<typeof serviceClient>, job: EnrichJob): Promise<void> {
  const { data: p } = await db.from("post").select("caption").eq("id", job.id).eq(
    "tenant_id",
    job.tenant_id,
  )
    .maybeSingle();
  const { data: trs } = await db.from("media_transcript").select("text").eq("post_id", job.id)
    .eq("tenant_id", job.tenant_id);
  const text = [p?.caption, ...((trs ?? []).map((t) => t.text))]
    .filter((s): s is string => !!s && s.trim().length > 0).join("\n").trim();
  if (!text) return; // no caption and no transcript yet — nothing to embed.
  const vec = toVectorLiteral(await embed(text));
  const { error } = await db.rpc("set_post_embedding", { p_id: job.id, p_embedding: vec });
  if (error) throw new Error(`set_post_embedding: ${error.message}`);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  // Cover any rows that lost their queue job (gap-filler — see reconcile_enrich_queue).
  const { data: requeued, error: recErr } = await db.rpc("reconcile_enrich_queue", {
    p_limit: 1000,
  });
  if (recErr) {
    log.error("reconcile_enrich_queue failed", { err: recErr.message });
    return errorResponse(500, "enrich_failed", "Could not reconcile the enrich queue.");
  }

  const { data: claimed, error: claimErr } = await db.rpc("claim_jobs", {
    p_queue: "enrich_jobs",
    p_qty: BATCH,
    p_vt: VT,
    p_max_reads: MAX_READS,
  });
  if (claimErr) {
    log.error("claim_jobs failed", { err: claimErr.message });
    return errorResponse(500, "enrich_failed", "Could not claim enrich jobs.");
  }

  const jobs = (claimed ?? []) as ClaimRow[];
  let processed = 0, failed = 0, skipped = 0;

  for (const row of jobs) {
    const job = row.message;
    try {
      if (!job || !job.id || !job.tenant_id) {
        skipped += 1;
        await db.rpc("complete_job", { p_queue: "enrich_jobs", p_msg_id: row.msg_id });
        continue;
      }
      if (job.kind === "comment") {
        await processComment(db, job);
      } else if (job.kind === "post") {
        await processPost(db, job);
      } else {
        log.warn("unknown enrich kind; dropping", { kind: job.kind });
        skipped += 1;
        await db.rpc("complete_job", { p_queue: "enrich_jobs", p_msg_id: row.msg_id });
        continue;
      }
      await db.rpc("complete_job", { p_queue: "enrich_jobs", p_msg_id: row.msg_id });
      processed += 1;
    } catch (e) {
      log.error("enrich job failed", { msg_id: row.msg_id, kind: job?.kind, err: String(e) });
      await db.rpc("fail_job", { p_queue: "enrich_jobs", p_msg_id: row.msg_id });
      failed += 1;
    }
  }

  log.info("enrich drained", { requeued, claimed: jobs.length, processed, failed, skipped });
  return jsonResponse({
    requeued: requeued ?? 0,
    claimed: jobs.length,
    processed,
    failed,
    skipped,
  });
});
