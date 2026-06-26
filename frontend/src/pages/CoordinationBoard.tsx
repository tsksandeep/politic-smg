// CoordinationBoard (US3, FR-011) — the live feed of INFERRED coordination events from the
// coordination_board view: synchronised timing, near-duplicate content, reused reel audio, and
// co-pushing author networks, each with score vs baseline and the contributing public accounts.
// Coordination is inference, not proof — the page is explicitly framed for human-in-the-loop
// review. Animates on new coordination_signal Realtime inserts.

import { useEffect, useMemo, useState } from "react";
import { supabase, subscribeToTables } from "../services/supabase";
import { CoordinationCard, type CoordinationRow } from "../components/CoordinationCard";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

type Filter = "all" | "temporal" | "content" | "shared_audio" | "author_network";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "all" },
  { key: "temporal", label: "timing" },
  { key: "content", label: "content" },
  { key: "shared_audio", label: "audio" },
  { key: "author_network", label: "authors" },
];

export default function CoordinationBoard() {
  const [rows, setRows] = useState<CoordinationRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const { data } = await supabase.from("coordination_board").select("*").order("detected_at", { ascending: false });
    setRows((data as CoordinationRow[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    return subscribeToTables("coordination-board", ["coordination_signal"], load);
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.signal_type === filter)),
    [rows, filter],
  );

  return (
    <AppShell title="Coordination">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          Inferred <span style={{ color: color.ember }}>coordination</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>{rows.length} events</span>
      </div>

      <div className="panel" style={{ padding: "12px 16px", marginBottom: 18, background: "#FFFCFB", borderColor: "rgba(214,73,46,0.30)" }}>
        <p style={{ margin: 0, fontSize: 13, color: color.textDim, lineHeight: 1.55 }}>
          These are <b style={{ color: color.emberDeep }}>inferred</b> signals fused from public posting times, near-duplicate captions,
          shared reel audio, and co-pushing author networks — never proof of coordination. A human must review before any action is taken.
        </p>
      </div>

      <div className="scanline" style={{ paddingBottom: 8, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: color.textDim }}>Live events</span>
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="sort-tab" data-active={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading coordination signals…</div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: 28, color: color.textFaint, fontSize: 13 }}>
          No coordination events {filter === "all" ? "detected" : `of type "${filter}"`}. A single isolated post does not trip detection.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.map((c) => <CoordinationCard key={c.id} c={c} />)}
        </div>
      )}
    </AppShell>
  );
}
