// FreshnessBanner (T031) — surfaces how current the board data is (FR-015). Never let the
// board silently show stale data; warn when the latest ingest is older than a threshold.
// Themed as a mono HUD readout with a status dot (ok = green, stale = ember).

import { color, MONO } from "../theme";

export function FreshnessBanner({ freshAsOf }: { freshAsOf: string | null }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: "0.04em",
  } as const;

  if (!freshAsOf) {
    return (
      <div style={{ ...base, color: color.textFaint }}>
        <Dot c={color.textFaint} />
        NO DATA INGESTED YET
      </div>
    );
  }

  const ageMin = Math.round((Date.now() - new Date(freshAsOf).getTime()) / 60000);
  const stale = ageMin > 20; // platform freshness window; tune with ingestion cadence
  const c = stale ? color.ember : color.positive;
  return (
    <div style={{ ...base, color: stale ? "#FFB7A6" : "rgba(255,255,255,0.7)" }}>
      <Dot c={c} />
      Data current as of {new Date(freshAsOf).toLocaleTimeString()} · {ageMin} min ago
      {stale ? " · possibly delayed (platform throttling?)" : ""}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: 9999, background: c, boxShadow: `0 0 8px ${c}` }} />;
}
