// AppShell — shared dashboard chrome so every authed page reads as the same product as the
// Landing hero: dark ops-console background + film grain + a branded top bar (wordmark, section
// tag, live indicator, sign-out). Wrap page content in <AppShell title="…">.

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { CLASH, color, MONO } from "../theme";

export default function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="app-shell">
      <div className="app-grain grain" aria-hidden="true" />
      <div className="app-content">
        <header
          className="app-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            borderBottom: `1px solid ${color.border}`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <span style={{ fontFamily: CLASH, fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Politic
            </span>
            <span style={{ width: 1, height: 18, background: color.border }} aria-hidden="true" />
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", color: color.textFaint, textTransform: "uppercase" }}>
              {title ?? "War Room"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <button type="button" onClick={signOut} className="btn btn-ghost" style={{ minHeight: 34, padding: "7px 16px", fontSize: 13 }}>
              Sign out
            </button>
          </div>
        </header>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
