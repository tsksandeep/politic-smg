// ConfidenceBadge (T030) — renders a probabilistic value as a labeled signal, never as fact
// (Principle V / FR-004). Use this everywhere a confidence/coordination score is shown.

export function ConfidenceBadge({ label, confidence }: { label: string; confidence: number }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const band = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "moderate" : "low";
  return (
    <span
      title="Signal, not a verdict"
      data-band={band}
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 12,
        border: "1px solid #ccc",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {pct}% ({band}) · signal
    </span>
  );
}
