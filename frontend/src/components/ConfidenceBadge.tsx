// ConfidenceBadge (T030) — renders a probabilistic value as a labeled signal, never as fact
// (Principle V / FR-004). Use this everywhere a confidence/coordination score is shown.
// Styled as a band-coloured mono pill (.cbadge in index.css) to match the ops-console theme.

export function ConfidenceBadge({ label, confidence }: { label: string; confidence: number }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const band = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "moderate" : "low";
  return (
    <span className="cbadge" data-band={band} title="Signal, not a verdict">
      {label} {pct}% · {band} · signal
    </span>
  );
}
