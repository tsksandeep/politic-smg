// FreshnessBanner (T031) — surfaces how current the board data is (FR-015). Never let the
// board silently show stale data; warn when the latest ingest is older than a threshold.

export function FreshnessBanner({ freshAsOf }: { freshAsOf: string | null }) {
  if (!freshAsOf) return <div style={{ color: "#888" }}>No data ingested yet.</div>;
  const ageMin = Math.round((Date.now() - new Date(freshAsOf).getTime()) / 60000);
  const stale = ageMin > 20; // platform freshness window; tune with ingestion cadence
  return (
    <div style={{ color: stale ? "#b00" : "#2a7", fontSize: 13 }}>
      Data current as of {new Date(freshAsOf).toLocaleTimeString()} ({ageMin} min ago)
      {stale ? " — possibly delayed (platform throttling?)" : ""}
    </div>
  );
}
