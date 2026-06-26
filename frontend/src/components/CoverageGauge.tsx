// CoverageGauge — the scaling-law gauge (FR-015, Principle IX): achieved daily capacity vs the
// tenant's target. Coverage gaps are surfaced EXPLICITLY, never hidden — when below target, the
// bar turns ember and the caption says so in words (colour is not the only cue).

import { color, MONO } from "../theme";

export function CoverageGauge({ achieved, target, label }: { achieved: number; target: number; label?: string }) {
  const pct = target > 0 ? Math.min(1, achieved / target) : 0;
  const short = target > 0 && achieved < target;
  const fill = short ? color.ember : color.positive;
  const gap = Math.max(0, target - achieved);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: color.textFaint }}>
          {label ?? "Daily capacity vs target"}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.text }}>
          {Math.round(achieved).toLocaleString()} / {Math.round(target).toLocaleString()}
        </span>
      </div>
      <div style={{ height: 12, borderRadius: 9999, background: color.track, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(pct * 100)}%`, background: fill, borderRadius: 9999, transition: "width .3s ease" }} />
      </div>
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.02em", margin: "8px 0 0", color: short ? color.emberDeep : color.textDim }}>
        {short
          ? `Coverage gap: ${Math.round(gap).toLocaleString()} captures/day below target — under-reporting is possible and is shown, not hidden.`
          : "At or above target capacity — coverage is full."}
      </p>
    </div>
  );
}
