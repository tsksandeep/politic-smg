// functions/analyze-comments (T024) — classify + embed unprocessed comments.
// Pull model: selects comments with no embedding yet (quota-bounded batch). For each:
//   Tier-1 (Flash-Lite): sentiment + language + confidence (JSON).
//   If confidence is low, escalate to Tier-2 (Flash) for a second opinion.
//   Embed the body (Gemini embeddings) → store via set_comment_analysis (vector cast in SQL).
// Every score is stored with its confidence (FR-004 / Principle V).

import { serviceClient } from "../../shared/db.ts";
import { chatJSON } from "../../shared/llm.ts";
import { embed, toVectorLiteral } from "../../shared/embeddings.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("analyze-comments");
const BATCH = Number(Deno.env.get("ANALYZE_BATCH") ?? "100");
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

Deno.serve(async () => {
  const db = serviceClient();
  const { data: comments } = await db
    .from("comment")
    .select("id, body")
    .is("embedding", null)
    .not("body", "is", null)
    .limit(BATCH);

  let processed = 0;
  for (const c of comments ?? []) {
    if (!c.body) continue;
    try {
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
      processed++;
    } catch (e) {
      log.error("analyze failed", { comment: c.id, error: String(e) });
    }
  }

  log.info("analyze batch done", { processed, scanned: comments?.length ?? 0 });
  return jsonResponse({ processed });
});
