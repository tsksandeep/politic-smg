// shared/labels.ts (T016) — honest-signal helpers (Principle V, FR-004).
// Every probabilistic value shipped to a user MUST be wrapped so the UI renders it as a
// confidence/estimate, never as fact. Centralizing this makes the rule enforceable and testable.

export interface Signal {
  value: number; // 0..1
  confidence: number; // 0..1
  /** Always true: marks this as a signal, not a verdict. */
  isSignalNotVerdict: true;
  label: string; // human-readable, e.g. "likely opposition (62% confidence)"
}

export type Band = "low" | "moderate" | "high";

export function band(confidence: number): Band {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "moderate";
  return "low";
}

/** Wrap a probabilistic classification as a labeled Signal. */
export function asSignal(value: number, confidence: number, descriptor: string): Signal {
  const pct = Math.round(confidence * 100);
  return {
    value,
    confidence,
    isSignalNotVerdict: true,
    label: `${descriptor} (${pct}% confidence, ${band(confidence)})`,
  };
}

/** Estimate wrapper for non-exact figures (e.g. modeled dedup reach). Never a raw count. */
export function asEstimate(value: number, descriptor: string): string {
  return `~${value.toLocaleString()} ${descriptor} (estimate)`;
}
