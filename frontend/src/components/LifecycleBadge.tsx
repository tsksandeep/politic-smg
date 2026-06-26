// LifecycleBadge — renders a narrative's lifecycle_state (emerging/peaking/decaying/dormant/
// resurgent) as a labelled pill. The state is an ESTIMATE from multi-sampled volume × velocity
// (FR-010, Principle V), so the badge title says so — colour is never the only cue, the word is.

import { color, MONO } from "../theme";

const STATES: Record<string, { label: string; fg: string; bg: string }> = {
  emerging: { label: "EMERGING", fg: color.ember, bg: "rgba(214,73,46,0.08)" },
  peaking: { label: "PEAKING", fg: color.emberDeep, bg: "rgba(190,60,34,0.10)" },
  decaying: { label: "DECAYING", fg: color.neutral, bg: "rgba(180,83,9,0.08)" },
  dormant: { label: "DORMANT", fg: color.textFaint, bg: "#F4F6F8" },
  resurgent: { label: "RESURGENT", fg: color.emberDeep, bg: "rgba(214,73,46,0.10)" },
};

export function LifecycleBadge({ state }: { state: string | null }) {
  const s = STATES[state ?? ""] ?? { label: (state ?? "unknown").toUpperCase(), fg: color.textFaint, bg: "#F4F6F8" };
  return (
    <span
      title="Lifecycle estimate from sampled volume × velocity — a signal, not a verdict"
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.12em",
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.fg}33`,
        borderRadius: 9999,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}
