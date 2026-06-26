// AppShell — shared dashboard chrome: a rounded, detached LEFT sidebar (brand + nav + sign-out)
// and a scrolling content column. Light theme; flat (no shadows / no backdrop blur). The Admin
// link is shown only to Admin users (FR-016); Analysts get a read/triage-only nav.

import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { useRole } from "../services/useRole";
import { CLASH, color, MONO } from "../theme";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/narratives", label: "Narratives", icon: "M12 2a10 10 0 1 0 10 10M12 7a5 5 0 1 0 5 5M12 12h9" },
  { to: "/alerts", label: "Alerts", icon: "M12 2 2 21h20L12 2zM12 9v5M12 17h.01" },
  { to: "/coordination", label: "Coordination", icon: "M6 6h.01M18 6h.01M6 18h.01M18 18h.01M6 6l12 12M18 6 6 18" },
  { to: "/amplifiers", label: "Amplifiers", icon: "M3 12h3l3-8 4 16 3-8h5" },
  { to: "/coverage", label: "Coverage", icon: "M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 3v9l6 3" },
  { to: "/admin", label: "Admin", icon: "M12 2 4 6v6c0 5 8 8 8 8s8-3 8-8V6l-8-4zM12 8v4M12 16h.01", adminOnly: true },
];

export default function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { role } = useRole();

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  }

  const items = NAV.filter((n) => !n.adminOnly || role === "admin");

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 0" }}>
          <span style={{ fontFamily: CLASH, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: color.text }}>
            Politic
          </span>
        </div>
        <div style={{ padding: "2px 8px 18px", fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: color.textFaint }}>
          {title ?? "War Room"}
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={n.icon} />
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ padding: "0 8px 10px", fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: color.textFaint }}>
          {role ? `${role} · single tenant` : "tenant-scoped"}
        </div>
        <button type="button" onClick={signOut} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", minHeight: 38, fontSize: 13 }}>
          Sign out
        </button>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
