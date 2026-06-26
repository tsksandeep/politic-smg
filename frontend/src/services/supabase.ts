// supabase.ts — the single Supabase client for the war-room SPA, plus thin Realtime helpers.
//
// Tenant isolation (Principle I) is enforced entirely in the database by RLS: the caller's
// tenant_id is resolved from their JWT via current_tenant(). The SPA therefore NEVER sends a
// tenant_id — every read goes through the RLS-scoped views and every Realtime subscription is
// automatically filtered to the signed-in user's tenant. Do not add client-side tenant filters.

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.",
  );
}

export const SUPABASE_URL = url as string;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/**
 * Subscribe to one or more public tables via Supabase Realtime. RLS scopes every change event
 * to the caller's tenant, so the SPA never receives another tenant's rows (see realtime.md).
 * Returns an unsubscribe cleanup for use in a useEffect return.
 */
export function subscribeToTables(
  channelName: string,
  tables: string[],
  onChange: () => void,
): () => void {
  let channel: RealtimeChannel = supabase.channel(channelName);
  for (const table of tables) {
    channel = channel.on(
      // deno-lint-ignore no-explicit-any
      "postgres_changes" as any,
      { event: "*", schema: "public", table },
      onChange,
    );
  }
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Authorization header for calling Edge Functions with the user's JWT (RLS-scoped). */
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Call a tenant-scoped Edge Function with the user JWT. The function reads the tenant from RLS. */
export async function callFunction(
  name: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<Response> {
  const auth = await authHeader();
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method,
    headers: { "Content-Type": "application/json", ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
