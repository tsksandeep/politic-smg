// AlertDetail (/alerts/:id, US3 / FR-019) — open one alert and triage it: acknowledge, assign,
// annotate, and close via the alert-triage Edge Function (user JWT, RLS-scoped). Status changes
// propagate live to other analysts of the same tenant through the alert Realtime channel. Shows
// the linked narrative + inferred coordination signal; response_latency is server-generated.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, subscribeToTables, callFunction } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import { Metric, sectionLabel } from "../components/detailKit";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

interface AlertDetailRow {
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
  acknowledged_at: string | null;
  closed_at: string | null;
  response_note: string | null;
  response_latency: string | null;
  data_fresh_as_of: string | null;
}

interface TenantUser {
  id: string;
  role: string;
}

const STATUS_COLOR: Record<string, string> = { open: color.ember, acknowledged: color.neutral, closed: color.positive };

export default function AlertDetail() {
  const { id } = useParams();
  const [a, setA] = useState<AlertDetailRow | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [row, us] = await Promise.all([
      supabase.from("alert_board").select("*").eq("id", id).maybeSingle(),
      supabase.from("tenant_user").select("id,role"),
    ]);
    const data = (row.data as AlertDetailRow) ?? null;
    setA(data);
    setUsers((us.data as TenantUser[]) ?? []);
    if (data) {
      setNote(data.response_note ?? "");
      setAssignee(data.assignee_user_id ?? "");
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
    return subscribeToTables(`alert-${id}`, ["alert"], load);
  }, [id]);

  async function triage(action: "acknowledge" | "assign" | "annotate" | "close") {
    if (!a || busy) return;
    setBusy(true);
    try {
      await callFunction(
        "alert-triage",
        {
          alert_id: a.id,
          action,
          ...(action === "assign" ? { assignee_user_id: assignee || null } : {}),
          ...(action === "annotate" || action === "close" ? { response_note: note || null } : {}),
        },
        "PATCH",
      );
      await load(); // optimistic refresh; Realtime also pushes to peers
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <AppShell title="Alert"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading alert…</div></AppShell>;
  }
  if (!a) {
    return (
      <AppShell title="Alert">
        <Link to="/alerts" className="backlink">← Alert queue</Link>
        <div className="panel" style={{ padding: 28, marginTop: 14, color: color.textDim }}>Alert not found (or not in your tenant).</div>
      </AppShell>
    );
  }

  const sc = STATUS_COLOR[a.status] ?? color.textFaint;
  const coord = a.coordination_score ?? a.score;

  return (
    <AppShell title="Alert">
      <Link to="/alerts" className="backlink">← Alert queue</Link>

      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.02em", margin: "14px 0 10px", paddingBottom: 12 }}>
        {a.theme_summary ?? (a.kind === "coordinated_attack" ? "Coordinated push detected" : "Emerging narrative")}
      </h1>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: a.kind === "coordinated_attack" ? color.emberDeep : color.neutral }}>
          {(a.kind ?? "").replace("_", " ").toUpperCase()}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: sc, border: `1px solid ${sc}55`, borderRadius: 9999, padding: "4px 10px" }}>{a.status.toUpperCase()}</span>
        <FreshnessBanner freshAsOf={a.data_fresh_as_of} />
      </div>

      <div className="detail-grid">
        <div className="detail-sticky" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Signal readout</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <Metric label="Volume" value={String(a.volume ?? 0)} />
              <Metric label="Growth" value={`${(a.growth_rate ?? 0) >= 0 ? "+" : ""}${(a.growth_rate ?? 0).toFixed(1)}`} />
              <Metric label="Detected" value={new Date(a.detected_at).toLocaleDateString()} />
              <Metric label="Latency" value={a.response_latency ?? (a.closed_at ? "—" : "open")} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {a.confidence != null && <ConfidenceBadge label="narrative" confidence={a.confidence} />}
              {coord != null && <ConfidenceBadge label="coordination (inferred)" confidence={coord} />}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {a.narrative_id && <Link to={`/narratives/${a.narrative_id}`} className="backlink">→ narrative</Link>}
              {a.coordination_signal_id && <Link to="/coordination" className="backlink">→ coordination feed</Link>}
            </div>
            <p style={{ color: color.textFaint, fontSize: 12.5, fontStyle: "italic", margin: "14px 0 0", lineHeight: 1.5 }}>
              Coordination is inferred, not proven. Review before acting (human-in-the-loop required).
            </p>
          </div>

          <section className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Triage</h3>

            <label style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.textFaint }}>Assign to</label>
            <select className="field" style={{ marginTop: 6, marginBottom: 12 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.id.slice(0, 8)}… · {u.role}</option>)}
            </select>

            <label style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.textFaint }}>Annotation</label>
            <textarea
              className="field"
              style={{ marginTop: 6 }}
              aria-label="Response note"
              placeholder="Response taken (counter-message, escalation, etc.)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={() => triage("acknowledge")} disabled={busy || a.status !== "open"}>Acknowledge</button>
              <button className="btn btn-ghost" onClick={() => triage("assign")} disabled={busy}>Assign</button>
              <button className="btn btn-ghost" onClick={() => triage("annotate")} disabled={busy}>Annotate</button>
              <button className="btn btn-primary" onClick={() => triage("close")} disabled={busy || a.status === "closed"}>Close &amp; log</button>
            </div>
          </section>
        </div>

        <div>
          <h3 style={sectionLabel}>Triage timeline</h3>
          <div className="panel" style={{ padding: 18, fontFamily: MONO, fontSize: 13, color: color.textDim, lineHeight: 2 }}>
            <div>DETECTED · {new Date(a.detected_at).toLocaleString()}</div>
            <div>ACKNOWLEDGED · {a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString() : "—"}</div>
            <div>CLOSED · {a.closed_at ? new Date(a.closed_at).toLocaleString() : "—"}</div>
            <div>ASSIGNEE · {a.assignee_user_id ? `${a.assignee_user_id.slice(0, 8)}…` : "unassigned"}</div>
            <div>RESPONSE LATENCY · {a.response_latency ?? "—"}</div>
          </div>
          {a.response_note && (
            <div className="panel" style={{ padding: 16, marginTop: 12 }}>
              <div style={{ ...sectionLabel, marginBottom: 8 }}>Logged response</div>
              <div style={{ fontSize: 14, color: color.text, lineHeight: 1.55 }}>{a.response_note}</div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
