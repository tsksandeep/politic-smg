// AlertDetail (T030) — opens one alert: theme, scale, anonymized example comments, and
// honest-signal confidence/coordination badges (Principle V). Commenter identity is never
// shown (FR-008). Triage controls are added in US3 (T044).

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO, sentimentColor } from "../theme";

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

  if (!detail) {
    return (
      <AppShell title="Alert">
        <div className="panel" style={{ padding: "28px", color: color.textDim, fontFamily: MONO, fontSize: 13 }}>
          Loading alert…
        </div>
      </AppShell>
    );
  }

  const statusColor = detail.status === "closed" ? color.positive : detail.status === "acknowledged" ? color.neutral : color.ember;

  return (
    <AppShell title="Alert">
      <Link to="/board" className="backlink">← War room board</Link>

      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.02em", margin: "14px 0 10px", paddingBottom: 12 }}>
        {detail.theme_summary ?? "Emerging narrative"}
      </h1>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: statusColor, border: `1px solid ${statusColor}55`, borderRadius: 9999, padding: "4px 10px" }}>
          {detail.status.toUpperCase()}
        </span>
        <FreshnessBanner freshAsOf={detail.data_fresh_as_of} />
      </div>

      <div className="detail-grid">
        {/* Left column — metrics, signals, triage */}
        <div className="detail-sticky" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Signal readout</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <Metric label="Volume" value={String(detail.volume)} />
              <Metric label="Growth" value={`×${detail.growth_rate?.toFixed(1)}`} />
              <Metric label="Scope" value={`${detail.affected_scope?.cadres ?? 0}c · ${detail.affected_scope?.posts ?? 0}p`} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <ConfidenceBadge label="anti-party" confidence={detail.confidence ?? 0} />
              <ConfidenceBadge label="coordination" confidence={detail.coordination_score ?? 0} />
            </div>
            <p style={{ color: color.textFaint, fontSize: 12.5, fontStyle: "italic", margin: 0, lineHeight: 1.5 }}>
              These are signals, not verdicts. Public-vs-opposition is inferred, not certain.
            </p>
          </div>

          <section className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Triage</h3>
            <textarea
              className="field"
              placeholder="Response taken (counter-message, escalation, etc.)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={() => triage("acknowledged")} disabled={detail.status !== "open"}>
                Acknowledge
              </button>
              <button className="btn btn-primary" onClick={() => triage("closed")} disabled={detail.status === "closed"}>
                Close &amp; log response
              </button>
            </div>
          </section>
        </div>

        {/* Right column — anonymized example comments */}
        <div>
          <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>Representative comments · anonymized</span>
            <span style={{ color: color.textDim }}>{detail.example_comments?.length ?? 0}</span>
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {detail.example_comments?.map((c, i) => (
              <div key={i} className="panel" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 3, alignSelf: "stretch", borderRadius: 9999, background: sentimentColor(c.sentiment), flexShrink: 0 }} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.92)", lineHeight: 1.5 }}>{c.body}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.04em", color: color.textFaint, marginTop: 6 }}>
                    <span style={{ color: sentimentColor(c.sentiment) }}>{c.sentiment}</span>
                    {" "}· {Math.round((c.sentiment_confidence ?? 0) * 100)}% · {c.language}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.textFaint }}>{label}</div>
      <div style={{ fontFamily: CLASH, fontSize: 22, fontWeight: 600, color: color.text, marginTop: 3 }}>{value}</div>
    </div>
  );
}

const sectionLabel = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: color.textFaint,
  margin: "0 0 12px",
  fontWeight: 600,
};
