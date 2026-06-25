// FreshnessBanner (T031) — surfaces how current the board data is (FR-015). Never let the
// board silently show stale data; warn when the latest ingest is older than a threshold.
// Mono HUD readout; colour shifts to ember when stale (text says so too — colour isn't the only cue).

import { color, MONO } from "../theme";

export function FreshnessBanner({ freshAsOf }: { freshAsOf: string | null }) {
  const base = {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: "0.04em",
  } as const;

  if (!freshAsOf) {
    return <div style={{ ...base, color: color.textFaint }}>No data ingested yet</div>;
  }

  const ageMin = Math.round((Date.now() - new Date(freshAsOf).getTime()) / 60000);
  const stale = ageMin > 20; // platform freshness window; tune with ingestion cadence
  return (
    <div style={{ ...base, color: stale ? color.emberDeep : color.textDim }}>
      Data current as of {new Date(freshAsOf).toLocaleTimeString()} · {ageMin} min ago
      {stale ? " · possibly delayed (platform throttling?)" : ""}
    </div>
  );
}
