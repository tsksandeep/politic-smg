// NarrativeBoard (US1, primary surface) — the live board of what the opposition's cadre is
// currently pushing, from the RLS-scoped narrative_board view: theme, stance, volume, growth,
// lifecycle, performance, and an inferred coordination signal. Updates live on narrative + alert
// Realtime changes (realtime.md). Strictly tenant-scoped by RLS — the SPA sends no tenant_id.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, subscribeToTables } from "../services/supabase";
import { FreshnessBanner } from "../components/FreshnessBanner";
import { NarrativeCard, type NarrativeRow } from "../components/NarrativeCard";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

type SortKey = "performance" | "growth" | "volume";

interface OpenAlert {
  id: string;
  narrative_id: string | null;
  theme_summary: string | null;
  kind: string;
  status: string;
}

export default function NarrativeBoard() {
  const [rows, setRows] = useState<NarrativeRow[]>([]);
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [sort, setSort] = useState<SortKey>("performance");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [n, a] = await Promise.all([
      supabase.from("narrative_board").select("*"),
      supabase.from("alert_board").select("id,narrative_id,theme_summary,kind,status").in("status", ["open", "acknowledged"]),
    ]);
    setRows((n.data as NarrativeRow[]) ?? []);
    setAlerts((a.data as OpenAlert[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    return subscribeToTables("narrative-board", ["narrative", "alert"], load);
  }, []);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((x, y) => {
      if (sort === "growth") return (y.growth_rate ?? 0) - (x.growth_rate ?? 0);
      if (sort === "volume") return (y.volume ?? 0) - (x.volume ?? 0);
      return (y.performance_score ?? 0) - (x.performance_score ?? 0);
    });
    return copy;
  }, [rows, sort]);

  const alertedNarrativeIds = useMemo(() => new Set(alerts.map((a) => a.narrative_id).filter(Boolean)), [alerts]);
  const freshest = useMemo(
    () => rows.map((r) => r.data_fresh_as_of).filter(Boolean).sort().at(-1) ?? null,
    [rows],
  );

  return (
    <AppShell title="War Room">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          What the opposition is <span style={{ color: color.ember }}>pushing</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>
          {rows.length} narratives · {alerts.length} open alerts
        </span>
      </div>
      <div style={{ marginBottom: 18 }}>
        <FreshnessBanner freshAsOf={freshest} />
      </div>

      {alerts.length > 0 && (
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 18, borderColor: "rgba(214,73,46,0.35)", background: "#FFFCFB" }}>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: color.emberDeep }}>
            {alerts.length} ACTIVE ALERT{alerts.length === 1 ? "" : "S"}
          </span>{" "}
          <Link to="/alerts" className="backlink" style={{ color: color.emberDeep }}>open the alert queue →</Link>
        </div>
      )}

      <div className="scanline" style={{ paddingBottom: 8, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: color.textDim }}>
          Live narratives
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["performance", "growth", "volume"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className="sort-tab"
              data-active={sort === k}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading narratives…</div>
      ) : sorted.length === 0 ? (
        <div className="panel" style={{ padding: 28, color: color.textFaint, fontSize: 13 }}>
          No narratives clustered yet. Once nodes capture public posts and enrichment runs, labelled clusters appear here.
        </div>
      ) : (
        <div className="board-grid">
          {sorted.map((n) => (
            <div key={n.id} style={{ position: "relative" }}>
              {alertedNarrativeIds.has(n.id) && (
                <span className="live-dot" style={{ position: "absolute", top: 12, right: 12, zIndex: 2, width: 8, height: 8, borderRadius: 9999, background: color.ember }} aria-label="active alert" />
              )}
              <NarrativeCard n={n} />
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
