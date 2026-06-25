// shared/log.ts (T017) — structured logging + error helpers for Edge Functions.
// JSON lines so logs are queryable; never log secrets or raw commenter handles (Principle III).

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, fn: string, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    fn,
    msg,
    ...fields,
  });
  (level === "error" ? console.error : console.log)(line);
}

export function logger(fn: string) {
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", fn, m, f),
    info: (m: string, f?: Record<string, unknown>) => emit("info", fn, m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", fn, m, f),
    error: (m: string, f?: Record<string, unknown>) => emit("error", fn, m, f),
  };
}

// CORS — the war-room SPA calls these functions cross-origin (different origin from the
// Supabase functions host). Allow the configured frontend origin; fall back to "*" since
// these APIs authenticate via the Authorization bearer, not cookies (no credentialed CORS).
const ALLOWED_ORIGIN = Deno.env.get("FRONTEND_ORIGIN") ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Vary": "Origin",
};

/** Handle a CORS preflight; returns a 204 Response for OPTIONS, otherwise null. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  return null;
}

/** Standard JSON error response for Edge Functions. */
export function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
