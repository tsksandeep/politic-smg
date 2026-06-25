// Onboarding (T040) — cadre consent UI (User Story 2). Connect a Creator/Business IG or
// YouTube account (redirects to platform consent), list connected accounts, and disconnect.
// Unsupported account types are surfaced as guidance (no data collected).

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../services/supabase";

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
    // Surface the result of an oauth-callback redirect (it returns the browser here with a status).
    const err = params.get("error");
    if (err === "unsupported_account_type") {
      setNotice("That account type isn't supported. Switch to a Creator/Business account, then reconnect.");
    } else if (err === "exchange_failed") {
      setNotice("We couldn't complete the authorization. Please try connecting again.");
    } else if (err === "account_error") {
      setNotice("Something went wrong saving the connection. Please try again.");
    } else if (params.get("connected") === "1") {
      setNotice("Account connected. We're backfilling the last 30 days of posts and comments.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(platform: "instagram" | "youtube") {
    if (!cadreId) {
      setNotice("No cadre selected. Open this page with a ?cadre=<id> for the cadre being connected.");
      return;
    }
    const res = await fetch(`${FN}/oauth-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ cadre_id: cadreId, platform }),
    });
    const { authorize_url } = await res.json();
    if (authorize_url) location.href = authorize_url;
  }

  async function disconnect(id: string) {
    await fetch(`${FN}/account-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ account_id: id }),
    });
    load();
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 640 }}>
      <h1>Connect your party accounts</h1>
      <p style={{ color: "#555" }}>
        We only read your own posts and their comments, with your consent. You can disconnect anytime.
      </p>
      {notice && <p style={{ color: "#b00" }}>{notice}</p>}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => connect("instagram")}>Connect Instagram</button>
        <button onClick={() => connect("youtube")}>Connect YouTube</button>
      </div>
      <h3>Connected</h3>
      <ul>
        {accounts.map((a) => (
          <li key={a.id}>
            {a.platform} · {a.consent_status}
            {a.consent_status === "connected" && (
              <button style={{ marginLeft: 8 }} onClick={() => disconnect(a.id)}>Disconnect</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
