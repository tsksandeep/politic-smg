// AmplifierRow — one ranked amplifier target from amplifier_targets (FR-012). Shows the public
// opposition handle, how reliably it converts the narrative into engagement velocity
// (amplification = an ESTIMATE, labelled), and an origin / patient-zero flag (also an estimate).
// No commenter identity is ever shown — only public account handles exist here.

import { Link } from "react-router-dom";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { color, MONO } from "../theme";

export interface AmplifierTarget {
  tracked_account_id: string;
  narrative_id: string | null;
  handle: string;
  theme_summary?: string | null;
  post_count: number;
  amplification_score: number;
  is_origin: boolean;
}

export function AmplifierRow({ a, rank, showNarrative }: { a: AmplifierTarget; rank?: number; showNarrative?: boolean }) {
  return (
    <div className="panel" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
      {rank != null && (
        <span style={{ fontFamily: MONO, fontSize: 13, color: color.textFaint, width: 26, textAlign: "right", flexShrink: 0 }}>#{rank}</span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: color.text }}>@{a.handle}</span>
          {a.is_origin && (
            <span title="Probable origin / patient-zero — an estimate, not proof" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: color.emberDeep, border: `1px solid ${color.ember}55`, background: "rgba(214,73,46,0.08)", borderRadius: 9999, padding: "2px 8px" }}>
              ORIGIN · EST.
            </span>
          )}
        </div>
        {showNarrative && a.theme_summary && a.narrative_id && (
          <Link to={`/narratives/${a.narrative_id}`} className="backlink" style={{ display: "inline-block", marginTop: 4 }}>
            {a.theme_summary}
          </Link>
        )}
      </div>
      <span style={{ fontFamily: MONO, fontSize: 12, color: color.textDim, flexShrink: 0 }}>
        {a.post_count} posts
      </span>
      <ConfidenceBadge label="amplification" confidence={a.amplification_score ?? 0} />
    </div>
  );
}
