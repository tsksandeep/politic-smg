// Onboarding (T040) — cadre consent UI (User Story 2). Connect a Creator/Business IG or YouTube
// account via the Nango Connect UI (consent runs through self-hosted Nango), list connected
// accounts, and disconnect. Unsupported account types are surfaced as guidance (no data collected).

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Nango from "@nangohq/frontend";
import { supabase } from "../services/supabase";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

// Browser-reachable Nango (Connect UI + API). Local → localhost:3003; prod → the deployed Nango.
const NANGO_HOST = import.meta.env.VITE_NANGO_HOST as string;

const ICON: Record<string, string> = {
  instagram:
    "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  youtube:
    "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
};

function BrandIcon({ platform }: { platform: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={ICON[platform] ?? ""} />
    </svg>
  );
}

interface Account {
  id: string;
  platform: string;
  consent_status: string;
  connected_at: string;
  backfill_done: boolean;
}

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export default function Onboarding() {
  const [params] = useSearchParams();
  const cadreId = params.get("cadre") ?? "";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function load() {
    const res = await fetch(`${FN}/accounts`, { headers: { Authorization: `Bearer ${await token()}` } });
    setAccounts(res.ok ? await res.json() : []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist a completed Nango connection (the SPA side of oauth-callback).
  async function recordConnection(platform: string, connectionId: string) {
    const rec = await fetch(`${FN}/oauth-callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ cadre_id: cadreId, platform, connection_id: connectionId }),
    });
    if (rec.ok) {
      setNotice("Account connected. We're backfilling the last 30 days of posts and comments.");
      load();
    } else if (rec.status === 422) {
      setNotice("That account type isn't supported. Switch to a Creator/Business account, then reconnect.");
    } else {
      setNotice("Something went wrong saving the connection. Please try again.");
    }
  }

  async function connect(platform: "instagram" | "youtube") {
    if (!cadreId) {
      setNotice("No cadre selected. Open this page with a ?cadre=<id> for the cadre being connected.");
      return;
    }
    // 1) ask the backend for a Nango connect session, 2) open the Nango Connect UI, 3) on success
    // record the returned connection id. Nango stores + auto-refreshes the token (no token here).
    const res = await fetch(`${FN}/oauth-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ cadre_id: cadreId, platform }),
    });
    const { connect_session_token } = await res.json();
    if (!connect_session_token) {
      setNotice("Couldn't start the connection. Please try again.");
      return;
    }
    const nango = new Nango({ connectSessionToken: connect_session_token, host: NANGO_HOST });
    nango.openConnectUI({
      apiURL: NANGO_HOST,
      onEvent: (event) => {
        if (event.type === "connect") {
          const connectionId = event.payload?.connectionId;
          if (connectionId) recordConnection(platform, connectionId);
        }
      },
    });
  }

  async function disconnect(id: string) {
    await fetch(`${FN}/account-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ account_id: id }),
    });
    load();
  }

  const noticeOk = notice?.startsWith("Account connected");

  return (
    <AppShell title="Onboarding">
      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 8px", paddingBottom: 12 }}>
        Connect your <span style={{ color: color.ember }}>accounts</span>
      </h1>
      <p style={{ color: color.textDim, fontSize: 14, lineHeight: 1.6, maxWidth: 680, margin: "0 0 22px" }}>
        We only read your own posts and their comments, with your consent. You can disconnect at any
        time, and your data is purged on the documented schedule.
      </p>

      {notice && (
        <div
          className="panel"
          style={{ padding: "12px 16px", marginBottom: 22, fontSize: 13, color: noticeOk ? color.positive : "#B23A20", background: noticeOk ? "rgba(21,128,61,0.06)" : "rgba(214,73,46,0.06)", borderColor: noticeOk ? "rgba(21,128,61,0.30)" : "rgba(214,73,46,0.30)" }}
        >
          {notice}
        </div>
      )}

      <div className="onboard-grid">
        {/* Left — connect actions */}
        <section className="panel" style={{ padding: 22 }}>
          <h3 style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: color.textFaint, margin: "0 0 14px" }}>
            Add a source
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => connect("instagram")}>
              <BrandIcon platform="instagram" /> Connect Instagram
            </button>
            <button className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => connect("youtube")}>
              <BrandIcon platform="youtube" /> Connect YouTube
            </button>
          </div>
          <p style={{ color: color.textFaint, fontSize: 12, lineHeight: 1.5, margin: "16px 0 0" }}>
            Only Creator/Business accounts are supported. Personal accounts are guided to convert —
            no data is collected.
          </p>
        </section>

        {/* Right — connected accounts */}
        <div>
          <h3 style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: color.textFaint, margin: "0 0 12px" }}>
            Connected accounts · {accounts.length}
          </h3>
          {accounts.length === 0 && (
            <div className="panel" style={{ padding: "22px", color: color.textFaint, fontSize: 13 }}>
              No accounts connected yet.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {accounts.map((a) => {
              const connected = a.consent_status === "connected";
              return (
                <div key={a.id} className="panel" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: color.text }}>
                    <span style={{ color: color.textDim, display: "inline-flex" }}><BrandIcon platform={a.platform} /></span>
                    <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{a.platform}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: connected ? color.positive : color.textFaint }}>
                      · {a.consent_status.toUpperCase()}
                    </span>
                  </span>
                  {connected && (
                    <button className="btn btn-ghost" style={{ minHeight: 32, padding: "6px 14px", fontSize: 13 }} onClick={() => disconnect(a.id)}>
                      Disconnect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
