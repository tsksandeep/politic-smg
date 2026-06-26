// tests/helpers.ts — shared fixtures + DB plumbing for the OpenPolitics backend test suite.
//
// Why deno-postgres (not supabase-js): the headline property is *tenant isolation under RLS*
// (Principle I / SC-001). RLS is enforced per database role + JWT claim, so the cleanest way to
// "act as tenant A's analyst" is to open a transaction, set `role authenticated`, and set the
// `request.jwt.claims` GUC that Supabase's `auth.uid()` reads. A direct Postgres connection lets us
// do exactly that, and also lets us call the `security definer` detection/coordination/reconcile
// functions as the service-role/cron context (superuser bypasses RLS, like the real backend).
//
// Run prerequisites (see tests/README.md):
//   supabase start            # local Postgres on 54322, with the auth schema + authenticated role
//   supabase db reset         # apply migrations 0001..0007
//   export COMMENTER_HASH_KEY=test-key   # only needed by edge-function unit code, not these SQL tests
//
// Connection is overridable via env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.

import { Client, type Transaction } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export const DB_CONFIG = {
  hostname: Deno.env.get("PGHOST") ?? "localhost",
  port: Number(Deno.env.get("PGPORT") ?? "54322"),
  user: Deno.env.get("PGUSER") ?? "postgres",
  password: Deno.env.get("PGPASSWORD") ?? "postgres",
  database: Deno.env.get("PGDATABASE") ?? "postgres",
};

/** Open a fresh superuser connection (service-role / cron context: RLS-bypassing). */
export async function connect(): Promise<Client> {
  const client = new Client(DB_CONFIG);
  await client.connect();
  return client;
}

export const uuid = (): string => crypto.randomUUID();

/**
 * Deterministic 768-dim pgvector literal.
 *
 * `cluster` picks a dominant axis (→ cosine similarity ≈ 1 for the same cluster, ≈ 0 across
 * clusters, so same-cluster cosine *distance* `<=>` is ≪ 0.25 and cross-cluster is ≈ 1 — matching
 * run_detection()'s sim_threshold). `variant` adds a tiny unique component so two posts in the same
 * cluster are not byte-identical yet still cluster together.
 */
export function vec(cluster: number, variant = 0): string {
  const dim = 768;
  const arr = new Array(dim).fill(0);
  arr[cluster % 700] = 1.0; // dominant axis = cluster identity
  arr[700 + (variant % 68)] = 0.01; // tiny per-item jitter (kept off the dominant axes)
  return `[${arr.join(",")}]`;
}

export interface SettingsOverride {
  emerging_velocity_threshold?: number;
  coordination_window?: string; // interval literal, e.g. '30 minutes'
  coordination_min_accounts?: number;
  min_cluster_volume?: number;
}

/** Insert a tenant + its detection_settings row; returns the tenant id. */
export async function createTenant(
  client: Client | Transaction,
  settings: SettingsOverride = {},
): Promise<string> {
  const id = uuid();
  await q(client, {
    text: `insert into tenant (id, name, jurisdiction) values ($1, $2, 'IN-DPDP')`,
    args: [id, `tenant-${id.slice(0, 8)}`],
  });
  await q(client, {
    text: `insert into detection_settings
             (tenant_id, emerging_velocity_threshold, coordination_window,
              coordination_min_accounts, min_cluster_volume)
           values ($1, $2, $3::interval, $4, $5)`,
    args: [
      id,
      settings.emerging_velocity_threshold ?? 2.0,
      settings.coordination_window ?? "30 minutes",
      settings.coordination_min_accounts ?? 4,
      settings.min_cluster_volume ?? 3,
    ],
  });
  return id;
}

/** Insert an auth.users row + a tenant_user; returns the user id (= auth.uid() for that staffer). */
export async function createUser(
  client: Client,
  tenantId: string,
  role: "admin" | "analyst",
): Promise<string> {
  const id = uuid();
  await q(client, {
    text: `insert into auth.users (id, email) values ($1, $2)`,
    args: [id, `${id.slice(0, 8)}@example.test`],
  });
  await q(client, {
    text: `insert into tenant_user (id, tenant_id, role) values ($1, $2, $3)`,
    args: [id, tenantId, role],
  });
  return id;
}

/** Insert a tracked_account; returns its id. */
export async function createTrackedAccount(
  client: Client,
  tenantId: string,
  handle: string,
): Promise<string> {
  const id = uuid();
  await q(client, {
    text:
      `insert into tracked_account (id, tenant_id, platform, handle) values ($1, $2, 'instagram', $3)`,
    args: [id, tenantId, handle],
  });
  return id;
}

/**
 * Run a callback *as a tenant staffer through RLS*: a transaction with `role authenticated` and the
 * JWT-claims GUC that `auth.uid()` (hence `current_tenant()`/`current_app_role()`) reads. Always
 * rolls back, so probing writes never pollute the DB. Use this for every "can/can't see B" assertion.
 */
export async function withUser<T>(
  client: Client,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = client.createTransaction(`as_${userId.replace(/-/g, "").slice(0, 16)}`);
  await tx.begin();
  try {
    // Set claims BEFORE dropping privileges; `set local` confines them to this transaction.
    await tx.queryArray({
      text: `select set_config('request.jwt.claims', $1, true)`,
      args: [JSON.stringify({ sub: userId, role: "authenticated" })],
    });
    await tx.queryArray(`set local role authenticated`);
    return await fn(tx);
  } finally {
    await tx.rollback();
  }
}

/** Small wrapper so callers can pass a Client or a Transaction uniformly. */
// deno-lint-ignore no-explicit-any
export function q(conn: Client | Transaction, cfg: { text: string; args?: any[] }) {
  // deno-lint-ignore no-explicit-any
  return (conn as any).queryObject(cfg);
}

/** Convenience: scalar count from a count(*)::int query. */
export async function count(
  conn: Client | Transaction,
  text: string,
  // deno-lint-ignore no-explicit-any
  args: any[] = [],
): Promise<number> {
  const r = await q(conn, { text, args }) as { rows: { n: number }[] };
  return r.rows[0]?.n ?? 0;
}
