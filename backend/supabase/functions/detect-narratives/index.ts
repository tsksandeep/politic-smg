// functions/detect-narratives (T025) — thin trigger over the SQL detection logic.
// 1) run_detection() (migration 0007): clusters hostile comments, recomputes metrics,
//    raises alerts crossing thresholds (positive/neutral excluded → FR-005).
// 2) For narratives still lacking a human-readable theme summary, ask Tier-2 (Flash) to
//    summarize a few representative (anonymized) example comments. The summary is a
//    descriptive label; numeric confidence stays on the narrative (Principle V).

import { serviceClient } from "../../shared/db.ts";
import { chat } from "../../shared/llm.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("detect-narratives");

Deno.serve(async () => {
  const db = serviceClient();

  const { error } = await db.rpc("run_detection");
  if (error) {
    log.error("run_detection failed", { error: error.message });
    return jsonResponse({ error: error.message }, 500);
  }

  // Summarize narratives that have activity but no theme yet (anti-party AND favourable).
  const { data: narratives } = await db
    .from("narrative")
    .select("id, stance")
    .is("theme_summary", null)
    .gt("volume", 0)
    .limit(20);

  let summarized = 0;
  for (const n of narratives ?? []) {
    const { data: examples } = await db
      .from("comment")
      .select("body")
      .eq("narrative_id", n.id)
      .not("body", "is", null)
      .limit(8);
    const sample = (examples ?? []).map((e) => `- ${e.body}`).join("\n");
    if (!sample) continue;
    const favourable = n.stance === "pro_party";
    const prompt = favourable
      ? `These are supportive/positive comments on our posts. In one short sentence, name the favourable theme (what the public is praising):\n${sample}`
      : `These are anti-party comments on our posts. In one short sentence, name the narrative theme:\n${sample}`;
    const system = favourable
      ? "Summarize the shared praise/support in <=15 words."
      : "Summarize the shared grievance/attack in <=15 words.";
    try {
      const summary = await chat(prompt, { tier: "nuanced", system });
      await db.from("narrative").update({ theme_summary: summary.trim() }).eq("id", n.id);
      summarized++;
    } catch (e) {
      log.error("summarize failed", { narrative: n.id, error: String(e) });
    }
  }

  log.info("detect done", { summarized });
  return jsonResponse({ summarized });
});
