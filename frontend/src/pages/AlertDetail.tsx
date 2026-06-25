// AlertDetail (T030) — opens one alert: theme, scale, anonymized example comments, and
// honest-signal confidence/coordination badges (Principle V). Commenter identity is never
// shown (FR-008). Triage controls are added in US3 (T044).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";

interface Detail {
  id: string;
  status: string;
  theme_summary: string | null;
  volume: number;
  growth_rate: number;
  confidence: number | null;
  coordination_score: number | null;
  affected_scope: { cadres?: number; posts?: number };
  data_fresh_as_of: string | null;
  example_comments: { body: string; sentiment: string; sentiment_confidence: number; language: string }[];
}

export default function AlertDetail() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/alert-detail?id=${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    setDetail(await res.json());
  }

  useEffect(() => {
    load();
  }, [id]);

  // Triage (US3): acknowledge / close with a response note (FR-013/FR-014).
  async function triage(status: "acknowledged" | "closed") {
    const { data: session } = await supabase.auth.getSession();
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/alert-triage`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token}`,
      },
      body: JSON.stringify({ id, status, response_note: note || undefined }),
    });
    load(); // refresh; other analysts see the change live via Realtime on the board
  }

  if (!detail) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 760 }}>
      <h1>{detail.theme_summary ?? "Emerging narrative"}</h1>
      <FreshnessBanner freshAsOf={detail.data_fresh_as_of} />
      <p style={{ color: "#555" }}>
        {detail.status.toUpperCase()} · volume {detail.volume} · growth ×{detail.growth_rate?.toFixed(1)} ·{" "}
        {detail.affected_scope?.cadres ?? 0} cadres, {detail.affected_scope?.posts ?? 0} posts
      </p>
      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        <ConfidenceBadge label="anti-party" confidence={detail.confidence ?? 0} />
        <ConfidenceBadge label="coordination" confidence={detail.coordination_score ?? 0} />
      </div>
      <p style={{ fontStyle: "italic", color: "#777" }}>
        These are signals, not verdicts. Public-vs-opposition is inferred, not certain.
      </p>
      <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, margin: "12px 0" }}>
        <h3 style={{ marginTop: 0 }}>Triage</h3>
        <textarea
          placeholder="Response taken (counter-message, escalation, etc.)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => triage("acknowledged")} disabled={detail.status !== "open"}>
            Acknowledge
          </button>
          <button onClick={() => triage("closed")} disabled={detail.status === "closed"}>
            Close &amp; log response
          </button>
        </div>
      </section>

      <h3>Representative comments (anonymized)</h3>
      <ul>
        {detail.example_comments?.map((c, i) => (
          <li key={i} style={{ margin: "8px 0" }}>
            <span>{c.body}</span>{" "}
            <small style={{ color: "#999" }}>
              [{c.sentiment} {Math.round((c.sentiment_confidence ?? 0) * 100)}% · {c.language}]
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
