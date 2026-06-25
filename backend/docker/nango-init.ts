// nango-init — one-shot local bootstrap for self-hosted Nango (mirrors migrate / realtime-init).
//
// Self-hosted Nango generates its environment Secret Key in its own DB on first boot (the hash is
// salted, so we can't pre-seed a known key). So at startup we:
//   1) wait for nango-server to be healthy,
//   2) read the dev environment Secret Key from nango-db,
//   3) create the instagram + youtube integrations (idempotent) with the local mock client creds,
//   4) publish the Secret Key into the Supabase `app_config` table so the Edge Functions can read
//      it at runtime (shared/nango.ts) — prod sets NANGO_SECRET_KEY via env instead.
// This keeps `docker compose up` fully turnkey: no dashboard step.

import postgres from "npm:postgres@3";

const NANGO = Deno.env.get("NANGO_HOST") ?? "http://nango-server:3003";
const NANGO_DB_URL = Deno.env.get("NANGO_DB_URL") ?? "postgresql://nango:nango@nango-db:5432/nango";
const SUPABASE_DB_URL = Deno.env.get("SUPABASE_ADMIN_DB_URL") ??
  "postgresql://supabase_admin:postgres@db:5432/postgres";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Local mock client creds (the mock ignores them); prod creates integrations in the dashboard.
const INTEGRATIONS = [
  {
    unique_key: "instagram",
    provider: "instagram",
    scopes: "instagram_basic,instagram_manage_comments,pages_show_list,business_management",
  },
  {
    unique_key: "youtube",
    provider: "youtube",
    scopes: "https://www.googleapis.com/auth/youtube.readonly",
  },
];

async function main() {
  // 1) wait for health
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${NANGO}/health`);
      if (r.ok) {
        healthy = true;
        break;
      }
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  if (!healthy) throw new Error("nango-server did not become healthy in time");

  // 2) read the dev Secret Key
  const ndb = postgres(NANGO_DB_URL, { max: 1 });
  const rows = await ndb`select secret_key from nango._nango_environments where name = 'dev' limit 1`;
  await ndb.end();
  const secretKey = rows[0]?.secret_key as string | undefined;
  if (!secretKey) throw new Error("could not read Nango dev secret_key from nango-db");

  // 3) create integrations (idempotent — Nango 409s on an existing unique_key, which we ignore)
  for (const i of INTEGRATIONS) {
    const res = await fetch(`${NANGO}/integrations`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: i.provider,
        unique_key: i.unique_key,
        credentials: {
          type: "OAUTH2",
          client_id: "mock-client-id",
          client_secret: "mock-client-secret",
          scopes: i.scopes,
        },
      }),
    });
    console.log(`[nango-init] integration ${i.unique_key}: ${res.status}`);
  }

  // 4) publish the Secret Key into Supabase's app_config table (read at runtime by shared/nango.ts)
  const sdb = postgres(SUPABASE_DB_URL, { max: 1 });
  await sdb`
    insert into app_config (key, value) values ('nango_secret_key', ${secretKey})
    on conflict (key) do update set value = excluded.value`;
  await sdb.end();
  console.log("[nango-init] published nango_secret_key to app_config; bootstrap complete");
}

await main();
