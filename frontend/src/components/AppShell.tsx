// AppShell — shared dashboard chrome: a rounded, detached LEFT sidebar (brand + nav + sign-out)
// and a scrolling content column. Light theme; flat (no shadows / no backdrop blur).

import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { CLASH, color, MONO } from "../theme";

const NAV = [
  {
    to: "/board",
    label: "War room",
    icon: "M12 2a10 10 0 1 0 10 10M12 7a5 5 0 1 0 5 5M12 12h9", // radar sweep
  },
  {
    to: "/onboarding",
    label: "Onboarding",
    icon: "M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8", // link
  },
];

export default function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  }

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
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={n.icon} />
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <button type="button" onClick={signOut} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", minHeight: 38, fontSize: 13 }}>
          Sign out
        </button>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
