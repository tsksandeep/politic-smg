// shared/nango.ts — client for self-hosted Nango, which manages all cadre OAuth + token storage +
// auto-refresh. Same code local and prod; only NANGO_HOST changes (local → in-network nango-server,
// prod → the deployed Nango). The Secret Key comes from env (prod) or the app_config table that
// nango-init published (local). Providers' OAuth URLs are overridden to the mock locally via the
// mounted providers.yaml, so onboarding runs offline.

import { serviceClient } from "./db.ts";

const HOST = (Deno.env.get("NANGO_HOST") ?? "").replace(/\/+$/, "");
let cachedKey: string | null = null;

function host(): string {
  if (!HOST) throw new Error("NANGO_HOST is not set");
  return HOST;
}

async function secretKey(): Promise<string> {
  const env = Deno.env.get("NANGO_SECRET_KEY");
  if (env) return env;
  if (cachedKey) return cachedKey;
  const { data, error } = await serviceClient()
    .from("app_config").select("value").eq("key", "nango_secret_key").maybeSingle();
  if (error || !data?.value) {
    throw new Error("NANGO_SECRET_KEY unset and app_config.nango_secret_key missing");
  }
  cachedKey = data.value as string;
  return cachedKey;
}

async function authHeaders(): Promise<HeadersInit> {
  return { "Authorization": `Bearer ${await secretKey()}`, "Content-Type": "application/json" };
}

export interface ConnectSession {
  token: string;
  connect_link: string;
  expires_at: string;
}

/** Create a Connect session for an end user (cadre) — the frontend SDK uses the returned token. */
export async function createConnectSession(
  endUserId: string,
  providerConfigKey: string,
): Promise<ConnectSession> {
  const res = await fetch(`${host()}/connect/sessions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      end_user: { id: endUserId },
      allowed_integrations: [providerConfigKey],
    }),
  });
  if (!res.ok) throw new Error(`Nango connect-session ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data as ConnectSession;
}

/** Get a fresh access token for a connection (Nango refreshes it on read). */
export async function getAccessToken(
  connectionId: string,
  providerConfigKey: string,
): Promise<string> {
  const url = `${host()}/connection/${encodeURIComponent(connectionId)}` +
    `?provider_config_key=${encodeURIComponent(providerConfigKey)}&refresh_token=true`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Nango get-connection ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const token = data?.credentials?.access_token;
  if (!token) throw new Error(`Nango connection ${connectionId} has no access_token`);
  return token as string;
}

/** Best-effort: delete a connection at Nango (used on revoke). Never throws. */
export async function deleteConnection(
  connectionId: string,
  providerConfigKey: string,
): Promise<void> {
  try {
    await fetch(
      `${host()}/connection/${encodeURIComponent(connectionId)}?provider_config_key=${
        encodeURIComponent(providerConfigKey)
      }`,
      { method: "DELETE", headers: await authHeaders() },
    );
  } catch { /* best-effort */ }
}
