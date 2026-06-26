// Alerts (US3, FR-019) — the war-room alert queue from the alert_board view: emerging-narrative
// early-warnings and coordinated-attack alerts, with triage status. Updates live on alert
// Realtime changes so triage by one analyst reflects to others in the same tenant (realtime.md).

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, subscribeToTables } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

export interface AlertRow {
  id: string;
  kind: string;
  status: string;
  narrative_id: string | null;
  coordination_signal_id: string | null;
  theme_summary: string | null;
  signal_type: string | null;
  confidence: number | null;
  coordination_score: number | null;
  score: number | null;
  volume: number | null;
  growth_rate: number | null;
  assignee_user_id: string | null;
  detected_at: string;
  data_fresh_as_of: string | null;
}

type StatusFilter = "active" | "open" | "acknowledged" | "closed" | "all";

const STATUS_COLOR: Record<string, string> = {
  open: color.ember,
  acknowledged: color.neutral,
  closed: color.positive,
};

const KIND_LABEL: Record<string, string> = {
  emerging_narrative: "EMERGING NARRATIVE",
  coordinated_attack: "COORDINATED ATTACK",
};

export default function Alerts() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const { data } = await supabase.from("alert_board").select("*").order("detected_at", { ascending: false });
    setRows((data as AlertRow[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    return subscribeToTables("alerts", ["alert"], load);
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "active") return rows.filter((r) => r.status === "open" || r.status === "acknowledged");
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const freshest = useMemo(() => rows.map((r) => r.data_fresh_as_of).filter(Boolean).sort().at(-1) ?? null, [rows]);

  return (
    <AppShell title="Alerts">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          Alert <span style={{ color: color.ember }}>queue</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>{filtered.length} shown · {rows.length} total</span>
      </div>
      <div style={{ marginBottom: 18 }}><FreshnessBanner freshAsOf={freshest} /></div>

      <div className="scanline" style={{ paddingBottom: 8, marginBottom: 14, display: "flex", justifyContent: "flex-end", gap: 4, flexWrap: "wrap" }}>
        {(["active", "open", "acknowledged", "closed", "all"] as StatusFilter[]).map((s) => (
          <button key={s} type="button" className="sort-tab" data-active={filter === s} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>

      {!loaded ? (
        <div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading alerts…</div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: 28, color: color.textFaint, fontSize: 13 }}>No {filter === "all" ? "" : filter} alerts.</div>
      ) : (
        <div className="board-grid">
          {filtered.map((a) => {
            const sc = STATUS_COLOR[a.status] ?? color.textFaint;
            return (
              <Link key={a.id} to={`/alerts/${a.id}`} className="panel card-link" style={{ padding: "18px 20px 18px 22px", position: "relative" }}>
                <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9999, background: sc }} aria-hidden="true" />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: a.kind === "coordinated_attack" ? color.emberDeep : color.neutral }}>
                    {KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: sc, border: `1px solid ${sc}55`, borderRadius: 9999, padding: "3px 9px", whiteSpace: "nowrap" }}>
                    {a.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontFamily: CLASH, fontSize: 16, fontWeight: 600, lineHeight: 1.28, color: color.text, margin: "10px 0 12px" }}>
                  {a.theme_summary ?? (a.kind === "coordinated_attack" ? "Coordinated push detected" : "Emerging narrative")}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {a.confidence != null && <ConfidenceBadge label="narrative" confidence={a.confidence} />}
                  {(a.coordination_score ?? a.score) != null && <ConfidenceBadge label="coordination (inferred)" confidence={(a.coordination_score ?? a.score) as number} />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
