// Coverage (US4 / FR-015, Principle IX) — the scaling-law view from node_coverage: active vs
// quarantined nodes, tracked accounts, pending/leased work, blocked-node coverage gaps, and the
// estimated daily capacity vs target. Coverage gaps are surfaced EXPLICITLY and never hidden;
// "your IT-wing strength is your scale". Updates live on node_heartbeat Realtime inserts.

import { useEffect, useState } from "react";
import { supabase, subscribeToTables } from "../services/supabase";
import { CoverageGauge } from "../components/CoverageGauge";
import { Metric, sectionLabel } from "../components/detailKit";
import { FreshnessBanner } from "../components/FreshnessBanner";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

interface Coverage {
  active_nodes: number;
  quarantined_nodes: number;
  blocked_nodes: number;
  target_node_count: number;
  tracked_accounts: number;
  pending_work: number;
  leased_work: number;
  daily_capacity_est: number;
  target_capacity: number | null;
  coverage_gap: number | null;
  data_fresh_as_of: string | null;
}

export default function Coverage() {
  const [c, setC] = useState<Coverage | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const { data } = await supabase.from("node_coverage").select("*").maybeSingle();
    setC((data as Coverage) ?? null);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    return subscribeToTables("coverage", ["node_heartbeat"], load);
  }, []);

  if (!loaded) {
    return <AppShell title="Coverage"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading coverage…</div></AppShell>;
  }

  const active = c?.active_nodes ?? 0;
  const target = c?.target_node_count ?? 0;
  const blocked = c?.blocked_nodes ?? 0;
  const quarantined = c?.quarantined_nodes ?? 0;
  const capacity = c?.daily_capacity_est ?? 0;
  // Prefer an explicit target_capacity; else derive from target node count × current per-node rate.
  const perNode = active > 0 ? capacity / active : 0;
  const targetCapacity = c?.target_capacity ?? (target > 0 ? Math.round(target * Math.max(perNode, 1)) : capacity);
  const nodesShort = target > 0 && active < target;

  return (
    <AppShell title="Coverage">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          Node <span style={{ color: color.ember }}>coverage</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>scaling-law view</span>
      </div>
      <div style={{ marginBottom: 18 }}><FreshnessBanner freshAsOf={c?.data_fresh_as_of ?? null} /></div>

      {(nodesShort || blocked > 0 || quarantined > 0) && (
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 18, background: "#FFFCFB", borderColor: "rgba(214,73,46,0.35)" }}>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: color.emberDeep }}>COVERAGE GAP</span>
          <span style={{ color: color.textDim, fontSize: 13, marginLeft: 10 }}>
            {nodesShort && `${target - active} node(s) below target. `}
            {blocked > 0 && `${blocked} node(s) IP-blocked. `}
            {quarantined > 0 && `${quarantined} node(s) quarantined (low trust). `}
            Capture degrades proportionally — this shortfall is shown, never hidden.
          </span>
        </div>
      )}

      <div className="panel" style={{ padding: "20px 18px", marginBottom: 18 }}>
        <h3 style={sectionLabel}>Throughput</h3>
        <CoverageGauge achieved={capacity} target={targetCapacity} label="Estimated captures / day vs target" />
      </div>

      <div className="coverage-grid">
        <StatCard label="Active nodes" value={active} sub={`of ${target} target`} accent={nodesShort ? color.ember : color.positive} />
        <StatCard label="Quarantined" value={quarantined} sub="low trust · down-weighted" accent={quarantined > 0 ? color.neutral : color.textDim} />
        <StatCard label="IP-blocked" value={blocked} sub="coverage gap source" accent={blocked > 0 ? color.ember : color.textDim} />
        <StatCard label="Tracked accounts" value={c?.tracked_accounts ?? 0} sub="capture targets" />
        <StatCard label="Pending work" value={c?.pending_work ?? 0} sub="awaiting lease" />
        <StatCard label="Leased work" value={c?.leased_work ?? 0} sub="in flight" />
      </div>

      <p style={{ color: color.textFaint, fontSize: 12.5, fontStyle: "italic", margin: "20px 0 0", lineHeight: 1.55, maxWidth: 720 }}>
        Daily capacity is an estimate that scales with active node count and per-node safe request rate. Below target node count, coverage degrades gracefully and visibly — it is never failed closed silently.
      </p>
    </AppShell>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: number; sub: string; accent?: string }) {
  return (
    <div className="panel" style={{ padding: 18 }}>
      <Metric label={label} value={value.toLocaleString()} accent={accent} />
      <div style={{ fontFamily: MONO, fontSize: 11, color: color.textFaint, marginTop: 8 }}>{sub}</div>
    </div>
  );
}
