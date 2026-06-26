// NarrativeCard — one row of the narrative board (US1): the opposition narrative's generated
// theme, its stance, volume/growth, lifecycle estimate, performance, and an INFERRED coordination
// signal. Every probabilistic value is a labelled signal (Principle V), never a verdict.

import { Link } from "react-router-dom";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { LifecycleBadge } from "./LifecycleBadge";
import { FreshnessBanner } from "./FreshnessBanner";
import { CLASH, color, MONO } from "../theme";

export interface NarrativeRow {
  id: string;
  theme_summary: string | null;
  stance: string | null;
  volume: number;
  growth_rate: number;
  lifecycle_state: string | null;
  performance_score: number | null;
  coordination_score: number | null;
  confidence: number | null;
  half_life_hours: number | null;
  data_fresh_as_of: string | null;
}

const STANCE: Record<string, { label: string; fg: string }> = {
  opposition_attack: { label: "ATTACK", fg: color.hostile },
  opposition_promote: { label: "PROMOTE", fg: color.neutral },
  neutral: { label: "NEUTRAL", fg: color.textFaint },
};

export function NarrativeCard({ n }: { n: NarrativeRow }) {
  const stance = STANCE[n.stance ?? ""] ?? { label: (n.stance ?? "—").toUpperCase(), fg: color.textFaint };
  const growth = n.growth_rate ?? 0;
  return (
    <Link to={`/narratives/${n.id}`} className="panel card-link" style={{ padding: "18px 20px 18px 22px", position: "relative" }}>
      <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9999, background: stance.fg }} aria-hidden="true" />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontFamily: CLASH, fontSize: 17, fontWeight: 600, lineHeight: 1.25, color: color.text }}>
          {n.theme_summary ?? "Unlabelled narrative cluster"}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: stance.fg, border: `1px solid ${stance.fg}55`, borderRadius: 9999, padding: "3px 8px", whiteSpace: "nowrap" }}>{stance.label}</span>
          <LifecycleBadge state={n.lifecycle_state} />
        </div>
      </div>

      <div style={{ fontFamily: MONO, fontSize: 12, color: color.textDim, margin: "10px 0 12px", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
        <span>VOL <b style={{ color: color.text }}>{n.volume ?? 0}</b></span>
        <span>GROWTH <b style={{ color: growth >= 0 ? color.positive : color.hostile }}>{growth >= 0 ? "+" : ""}{growth.toFixed(1)}</b></span>
        <span>PERF <b style={{ color: color.text }}>{Math.round(n.performance_score ?? 0).toLocaleString()}</b></span>
        {n.half_life_hours != null && <span>HALF-LIFE <b style={{ color: color.text }}>{n.half_life_hours.toFixed(0)}h</b></span>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <ConfidenceBadge label="narrative" confidence={n.confidence ?? 0} />
        {n.coordination_score != null && <ConfidenceBadge label="coordination (inferred)" confidence={n.coordination_score} />}
      </div>

      <FreshnessBanner freshAsOf={n.data_fresh_as_of} />
    </Link>
  );
}
