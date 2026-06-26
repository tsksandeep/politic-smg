// CoordinationCard — one inferred coordination event from coordination_board (US3, FR-011).
// Coordination is INFERRED, never proven: the card is explicitly labelled and frames a
// human-in-the-loop review. Shows the signal type, score vs baseline, and the contributing
// public accounts. The score renders as a signal (Principle V).

import { Link } from "react-router-dom";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { color, MONO } from "../theme";

export interface CoordinationRow {
  id: string;
  narrative_id: string | null;
  theme_summary?: string | null;
  signal_type: string;
  score: number;
  baseline: number;
  account_handles?: string[] | null;
  account_ids?: string[] | null;
  evidence?: Record<string, unknown> | null;
  detected_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  temporal: "Synchronised timing",
  content: "Near-duplicate content",
  shared_audio: "Reused reel audio",
  author_network: "Co-pushing author network",
};

export function CoordinationCard({ c }: { c: CoordinationRow }) {
  const handles = c.account_handles ?? [];
  const count = handles.length || (c.account_ids?.length ?? 0);
  const over = c.baseline ? (c.score / c.baseline) : 0;
  return (
    <div className="panel" style={{ padding: "16px 18px", position: "relative" }}>
      <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9999, background: color.ember }} aria-hidden="true" />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginLeft: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: color.text, fontSize: 15 }}>
            {TYPE_LABEL[c.signal_type] ?? c.signal_type}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: color.emberDeep, border: `1px solid ${color.ember}55`, background: "rgba(214,73,46,0.08)", borderRadius: 9999, padding: "2px 8px", marginLeft: 10 }}>
            INFERRED
          </span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 11, color: color.textFaint, whiteSpace: "nowrap" }}>
          {new Date(c.detected_at).toLocaleString()}
        </span>
      </div>

      <div style={{ fontFamily: MONO, fontSize: 12, color: color.textDim, margin: "10px 0 12px 8px", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
        <span>SCORE <b style={{ color: color.text }}>{(c.score ?? 0).toFixed(2)}</b></span>
        <span>BASELINE <b style={{ color: color.text }}>{(c.baseline ?? 0).toFixed(2)}</b></span>
        {over > 0 && <span>×BASELINE <b style={{ color: color.ember }}>{over.toFixed(1)}</b></span>}
        <span>{count} account{count === 1 ? "" : "s"}</span>
      </div>

      <div style={{ marginLeft: 8, marginBottom: handles.length ? 10 : 0 }}>
        <ConfidenceBadge label="coordination (inferred)" confidence={c.score ?? 0} />
        {c.theme_summary && c.narrative_id && (
          <Link to={`/narratives/${c.narrative_id}`} className="backlink" style={{ marginLeft: 12 }}>
            {c.theme_summary}
          </Link>
        )}
      </div>

      {handles.length > 0 && (
        <div style={{ marginLeft: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {handles.map((h) => (
            <span key={h} style={{ fontFamily: MONO, fontSize: 11, color: color.textDim, background: color.track, borderRadius: 9999, padding: "2px 9px" }}>@{h}</span>
          ))}
        </div>
      )}

      <p style={{ marginLeft: 8, color: color.textFaint, fontSize: 12, fontStyle: "italic", margin: "12px 0 0 8px", lineHeight: 1.5 }}>
        Inferred from public signals — review before any action (human-in-the-loop required).
      </p>
    </div>
  );
}
