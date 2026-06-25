// theme.ts — shared design tokens. The authed app uses a LIGHT theme (clean white surfaces,
// slate text, ember accent); the public Landing hero stays dark (it owns its own styles).
// Pair with the .app-* / .panel / .btn / .field classes in index.css for hover/focus/animation.

export const CLASH = "'Clash Display', ui-sans-serif, system-ui, sans-serif";
export const SATOSHI = "'Satoshi', ui-sans-serif, system-ui, sans-serif";
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export const color = {
  bg: "#F5F6F8", // page (soft off-white so white cards read as surfaces)
  panel: "#FFFFFF", // card surface
  panelSolid: "#FFFFFF",
  border: "#E4E7EB", // ~slate-200
  borderStrong: "#D2D7DD",
  text: "#0F172A", // slate-900
  textDim: "#475569", // slate-600
  textFaint: "#64748B", // slate-500 (AA for small mono labels)
  ember: "#D6492E", // brand accent — reads on white as both fill and text (vivid #FF5A36 fails as text)
  emberDeep: "#BE3C22", // pressed/hover + small-text ember
  hostile: "#D6492E", // readable as both chip text and fill
  neutral: "#B45309", // amber-700
  positive: "#15803D", // green-700
  danger: "#DC2626",
  track: "#EAEDF0", // bar/progress track on light
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
