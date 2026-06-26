// Admin (FR-016) — Admin-only management: tracked_account target list, nodes (+ issue enrolment
// codes), detection_settings, and tenant_user. Analysts are read/triage only and see a denied
// notice. All writes are tenant-scoped by RLS — the SPA never sends a tenant_id; the database
// resolves it from current_tenant(). Privileged provisioning (node enrol, user invite) goes
// through Edge Functions so secrets (token hashing) never touch the client.

import { useEffect, useState } from "react";
import { supabase, callFunction } from "../services/supabase";
import { useRole } from "../services/useRole";
import { sectionLabel } from "../components/detailKit";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

interface TrackedAccount {
  id: string;
  platform: string;
  handle: string;
  is_private: boolean;
  priority: number;
}
interface NodeRow {
  id: string;
  label: string;
  trust_score: number;
  status: string;
  last_seen_at: string | null;
}
interface TenantUser {
  id: string;
  role: string;
}
interface DetectionSettings {
  emerging_velocity_threshold: number;
  coordination_window: string;
  coordination_min_accounts: number;
  min_cluster_volume: number;
  sim_threshold: number;
}

export default function Admin() {
  const { role, loading } = useRole();

  if (loading) {
    return <AppShell title="Admin"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Checking permissions…</div></AppShell>;
  }
  if (role !== "admin") {
    return (
      <AppShell title="Admin">
        <h1 style={{ fontFamily: CLASH, fontSize: "1.8rem", fontWeight: 600, margin: "0 0 12px" }}>Admin</h1>
        <div className="panel" style={{ padding: 24, color: color.textDim }}>
          Admin-only area. Your role is <b>{role ?? "unknown"}</b> — Analysts have read &amp; triage access only (FR-016).
        </div>
      </AppShell>
    );
  }
  return <AdminConsole />;
}

function AdminConsole() {
  return (
    <AppShell title="Admin">
      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px", paddingBottom: 12 }}>
        Tenant <span style={{ color: color.ember }}>administration</span>
      </h1>
      <p style={{ color: color.textFaint, fontSize: 13, margin: "0 0 24px" }}>Single tenant · all writes are RLS-scoped to your organisation.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <TargetList />
        <Nodes />
        <Detection />
        <Users />
      </div>
    </AppShell>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 style={{ ...sectionLabel, margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- Tracked accounts (capture target list) ----------------------------------------------------
function TargetList() {
  const [rows, setRows] = useState<TrackedAccount[]>([]);
  const [handle, setHandle] = useState("");
  const [priority, setPriority] = useState(5);
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase.from("tracked_account").select("id,platform,handle,is_private,priority").order("priority", { ascending: false });
    setRows((data as TrackedAccount[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    // No tenant_id sent — RLS / a default fills it from current_tenant().
    const { error } = await supabase.from("tracked_account").insert({ platform: "instagram", handle: h, priority });
    setMsg(error ? `Error: ${error.message}` : `Added @${h}`);
    setHandle("");
    if (!error) load();
  }
  async function remove(id: string) {
    await supabase.from("tracked_account").delete().eq("id", id);
    load();
  }

  return (
    <Section title={`Tracked accounts · ${rows.length}`}>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: rows.length ? 14 : 0 }}>
          <input className="field" style={{ flex: 1, minWidth: 180 }} placeholder="opposition handle (e.g. @cadre_account)" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <input className="field" style={{ width: 110 }} type="number" min={0} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))} aria-label="priority" />
          <button className="btn btn-primary" onClick={add}>Add target</button>
        </div>
        {msg && <div style={{ fontFamily: MONO, fontSize: 11, color: color.textDim, marginBottom: 10 }}>{msg}</div>}
        {rows.length > 0 && (
          <table className="tbl">
            <thead><tr><th>Handle</th><th>Platform</th><th>Priority</th><th>State</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>@{r.handle}</td>
                  <td>{r.platform}</td>
                  <td>{r.priority}</td>
                  <td>{r.is_private ? <span style={{ color: color.neutral }}>private · dropped</span> : "public"}</td>
                  <td style={{ textAlign: "right" }}><button className="link-danger" onClick={() => remove(r.id)}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

// ---- Nodes (+ enrolment codes) -----------------------------------------------------------------
function Nodes() {
  const [rows, setRows] = useState<NodeRow[]>([]);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase.from("node").select("id,label,trust_score,status,last_seen_at").order("last_seen_at", { ascending: false });
    setRows((data as NodeRow[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function enrol() {
    const l = label.trim();
    if (!l) return;
    setMsg("Issuing enrolment code…");
    setCode(null);
    try {
      // Token/hash generation is server-side (secrets never touch the client, Principle III).
      const res = await callFunction("node-enroll", { label: l });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        setCode(json.enrolment_code ?? json.token ?? "(issued — check server)");
        setMsg("Enrolment code issued — shown once. Hand it to the operator out-of-band.");
        setLabel("");
        load();
      } else {
        setMsg(`Could not issue code (${res.status}). Is the node-enroll function deployed?`);
      }
    } catch {
      setMsg("Could not reach the node-enroll function.");
    }
  }
  async function revoke(id: string) {
    await supabase.from("node").update({ status: "revoked" }).eq("id", id);
    load();
  }

  return (
    <Section title={`Nodes · ${rows.length}`}>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input className="field" style={{ flex: 1, minWidth: 180 }} placeholder="node label (e.g. volunteer-chennai-01)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn btn-primary" onClick={enrol}>Issue enrolment code</button>
        </div>
        {code && (
          <div className="panel" style={{ padding: "10px 14px", marginBottom: 12, background: "#FFFCFB", borderColor: "rgba(214,73,46,0.35)" }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: color.emberDeep }}>ENROLMENT CODE · SHOWN ONCE</div>
            <code style={{ fontFamily: MONO, fontSize: 14, color: color.text, wordBreak: "break-all" }}>{code}</code>
          </div>
        )}
        {msg && <div style={{ fontFamily: MONO, fontSize: 11, color: color.textDim, marginBottom: 10 }}>{msg}</div>}
        {rows.length > 0 && (
          <table className="tbl">
            <thead><tr><th>Label</th><th>Trust</th><th>Status</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{Math.round((r.trust_score ?? 0) * 100)}%</td>
                  <td><span style={{ color: r.status === "active" ? color.positive : r.status === "quarantined" ? color.neutral : color.textFaint }}>{r.status}</span></td>
                  <td>{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "never"}</td>
                  <td style={{ textAlign: "right" }}>{r.status !== "revoked" && <button className="link-danger" onClick={() => revoke(r.id)}>revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

// ---- Detection settings ------------------------------------------------------------------------
function Detection() {
  const [s, setS] = useState<DetectionSettings | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase.from("detection_settings").select("emerging_velocity_threshold,coordination_window,coordination_min_accounts,min_cluster_volume,sim_threshold").maybeSingle();
    setS((data as DetectionSettings) ?? { emerging_velocity_threshold: 2.0, coordination_window: "02:00:00", coordination_min_accounts: 3, min_cluster_volume: 5, sim_threshold: 0.25 });
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!s) return;
    // Upsert without tenant_id; RLS pins the row to the caller's tenant.
    const { error } = await supabase.from("detection_settings").upsert(s, { onConflict: "tenant_id" });
    setMsg(error ? `Error: ${error.message}` : "Saved.");
  }
  function set<K extends keyof DetectionSettings>(k: K, v: DetectionSettings[K]) {
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  if (!s) return <Section title="Detection settings"><div className="panel" style={{ padding: 16, color: color.textFaint, fontSize: 13 }}>Loading…</div></Section>;

  return (
    <Section title="Detection settings" action={<button className="btn btn-primary" onClick={save} style={{ minHeight: 34, padding: "8px 16px" }}>Save</button>}>
      <div className="panel" style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <Field label="Emerging velocity threshold" hint="early-warning trip">
          <input className="field" type="number" step={0.1} value={s.emerging_velocity_threshold} onChange={(e) => set("emerging_velocity_threshold", Number(e.target.value))} />
        </Field>
        <Field label="Coordination window" hint="synchrony window (hh:mm:ss)">
          <input className="field" value={s.coordination_window} onChange={(e) => set("coordination_window", e.target.value)} />
        </Field>
        <Field label="Min accounts for coordination" hint="distinct accounts">
          <input className="field" type="number" value={s.coordination_min_accounts} onChange={(e) => set("coordination_min_accounts", Number(e.target.value))} />
        </Field>
        <Field label="Min cluster volume" hint="narrative materiality floor">
          <input className="field" type="number" value={s.min_cluster_volume} onChange={(e) => set("min_cluster_volume", Number(e.target.value))} />
        </Field>
        <Field label="Similarity threshold" hint="cosine cut-off · 0.25 tight, 0.4–0.5 for short/code-mixed">
          <input className="field" type="number" step={0.05} min={0.05} max={0.95} value={s.sim_threshold} onChange={(e) => set("sim_threshold", Number(e.target.value))} />
        </Field>
      </div>
      {msg && <div style={{ fontFamily: MONO, fontSize: 11, color: color.textDim, marginTop: 10 }}>{msg}</div>}
    </Section>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: color.textFaint, marginBottom: 6 }}>{label}</div>
      {children}
      <div style={{ fontFamily: MONO, fontSize: 10, color: color.textFaint, marginTop: 4 }}>{hint}</div>
    </label>
  );
}

// ---- Tenant users ------------------------------------------------------------------------------
function Users() {
  const [rows, setRows] = useState<TenantUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "analyst">("analyst");
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase.from("tenant_user").select("id,role");
    setRows((data as TenantUser[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function invite() {
    const e = email.trim();
    if (!e) return;
    setMsg("Inviting…");
    try {
      const res = await callFunction("user-invite", { email: e, role });
      setMsg(res.ok ? `Invite sent to ${e}.` : `Could not invite (${res.status}). Is the user-invite function deployed?`);
      if (res.ok) { setEmail(""); load(); }
    } catch {
      setMsg("Could not reach the user-invite function.");
    }
  }

  return (
    <Section title={`Tenant users · ${rows.length}`}>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: rows.length ? 14 : 0 }}>
          <input className="field" style={{ flex: 1, minWidth: 200 }} type="email" placeholder="staff@yourparty.in" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="field" style={{ width: 140 }} value={role} onChange={(e) => setRole(e.target.value as "admin" | "analyst")}>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" onClick={invite}>Invite</button>
        </div>
        {msg && <div style={{ fontFamily: MONO, fontSize: 11, color: color.textDim, marginBottom: 10 }}>{msg}</div>}
        {rows.length > 0 && (
          <table className="tbl">
            <thead><tr><th>User</th><th>Role</th></tr></thead>
            <tbody>
              {rows.map((r) => <tr key={r.id}><td style={{ fontFamily: MONO }}>{r.id.slice(0, 12)}…</td><td>{r.role}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}
