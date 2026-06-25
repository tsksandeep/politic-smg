// NarrativeDetail (/narratives/:id) — read-only drill-down for a narrative (used by the
// favourable best/worst cards, and reachable from a cadre's narratives). Shows the theme, its
// performance metrics, an honest-signal confidence, and anonymized example comments. No triage:
// favourable narratives are tracked for performance, not actioned (anti-party uses the alert flow).

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import AppShell from "../components/AppShell";
import { CommentList, type ExampleComment, Metric, sectionLabel } from "../components/detailKit";
import { CLASH, color, MONO } from "../theme";

interface NarrativeRow {
  id: string;
  stance: string;
  theme_summary: string | null;
  volume: number;
  growth_rate: number;
  confidence: number | null;
  coordination_score: number | null;
  performance_score: number;
  affected_scope: { cadres?: number; posts?: number };
  data_fresh_as_of: string | null;
}

export default function NarrativeDetail() {
  const { id } = useParams();
  const [n, setN] = useState<NarrativeRow | null>(null);
  const [examples, setExamples] = useState<ExampleComment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [row, ex] = await Promise.all([
        supabase.from("narrative_board").select("*").eq("id", id).maybeSingle(),
        supabase.from("comment").select("body,sentiment,sentiment_confidence,language").eq("narrative_id", id).not("body", "is", null).limit(12),
      ]);
      setN((row.data as NarrativeRow) ?? null);
      setExamples((ex.data as ExampleComment[]) ?? []);
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded) {
    return <AppShell title="Narrative"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading narrative…</div></AppShell>;
  }
  if (!n) {
    return (
      <AppShell title="Narrative">
        <Link to="/board" className="backlink">← War room board</Link>
        <div className="panel" style={{ padding: 28, marginTop: 14, color: color.textDim }}>Narrative not found.</div>
      </AppShell>
    );
  }

  const favourable = n.stance === "pro_party";
  const accent = favourable ? color.positive : color.ember;

  return (
    <AppShell title="Narrative">
      <Link to="/board" className="backlink">← War room board</Link>

      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.02em", margin: "14px 0 10px", paddingBottom: 12 }}>
        {n.theme_summary ?? "Narrative"}
      </h1>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: accent, border: `1px solid ${accent}55`, borderRadius: 9999, padding: "4px 10px" }}>
          {favourable ? "FAVOURABLE" : "ANTI-PARTY"}
        </span>
        <FreshnessBanner freshAsOf={n.data_fresh_as_of} />
      </div>

      <div className="detail-grid">
        <div className="detail-sticky" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Performance</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <Metric label="Volume" value={String(n.volume)} />
              <Metric label="Growth" value={`×${n.growth_rate?.toFixed(1)}`} />
              <Metric label="Performance" value={Math.round(n.performance_score).toLocaleString()} accent={accent} />
              <Metric label="Scope" value={`${n.affected_scope?.cadres ?? 0}c · ${n.affected_scope?.posts ?? 0}p`} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ConfidenceBadge label={favourable ? "support" : "anti-party"} confidence={n.confidence ?? 0} />
              {!favourable && <ConfidenceBadge label="coordination" confidence={n.coordination_score ?? 0} />}
            </div>
            <p style={{ color: color.textFaint, fontSize: 12.5, fontStyle: "italic", margin: "14px 0 0", lineHeight: 1.5 }}>
              {favourable
                ? "A favourable narrative — tracked for performance, not actioned."
                : "These are signals, not verdicts. Public-vs-opposition is inferred, not certain."}
            </p>
          </div>
        </div>

        <div>
          <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>{favourable ? "Supportive comments · anonymized" : "Representative comments · anonymized"}</span>
            <span style={{ color: color.textDim }}>{examples.length}</span>
          </h3>
          <CommentList comments={examples} />
        </div>
      </div>
    </AppShell>
  );
}
