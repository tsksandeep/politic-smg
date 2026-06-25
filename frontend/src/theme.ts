// theme.ts — shared design tokens for the "cinematic war room" ops-console look.
// Mirrors the Landing hero (Clash Display + Satoshi + mono, near-black navy, ember accent) so
// every dashboard page reads as the same product. Pair with the .app-* / .panel / .btn / .field
// classes in index.css for hover/focus/animation states (inline styles can't do those).

export const CLASH = "'Clash Display', ui-sans-serif, system-ui, sans-serif";
export const SATOSHI = "'Satoshi', ui-sans-serif, system-ui, sans-serif";
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export const color = {
  bg: "#05070d",
  panel: "rgba(20,27,51,0.45)",
  panelSolid: "#0b1024",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#ffffff",
  textDim: "rgba(255,255,255,0.62)",
  textFaint: "rgba(255,255,255,0.40)",
  ember: "#FF5A36",
  emberDeep: "#D6492E",
  hostile: "#FF5A36",
  neutral: "#E0A23C",
  positive: "#37C28B",
  danger: "#ff6b57",
};

/** Color a sentiment label (hostile/neutral/positive) consistently across the app. */
export function sentimentColor(s: string): string {
  if (s === "hostile") return color.hostile;
  if (s === "positive") return color.positive;
  return color.neutral;
}

/** Uppercase mono micro-label used for HUD/metric captions. */
export const hudLabel = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: color.textFaint,
};
