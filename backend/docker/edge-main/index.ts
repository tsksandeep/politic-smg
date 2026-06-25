// Edge Functions "main" router for the self-hosted edge-runtime (mirrors the Supabase CLI's
// internal main service). Routes /<function-name> to supabase/functions/<name>/index.ts, honoring
// the per-function verifyJWT flags in SUPABASE_INTERNAL_FUNCTIONS_CONFIG. Do not edit lightly.

import { STATUS_CODE, STATUS_TEXT } from "https://deno.land/std/http/status.ts";
import * as posix from "https://deno.land/std/path/posix/mod.ts";
import * as jose from "https://deno.land/x/jose@v4.13.1/index.ts";

const SB_SPECIFIC_ERROR_CODE = {
  BootError: STATUS_CODE.ServiceUnavailable,
  InvalidWorkerResponse: STATUS_CODE.InternalServerError,
  WorkerLimit: 546,
};
const SB_SPECIFIC_ERROR_TEXT = {
  [SB_SPECIFIC_ERROR_CODE.BootError]: "BOOT_ERROR",
  [SB_SPECIFIC_ERROR_CODE.InvalidWorkerResponse]: "WORKER_ERROR",
  [SB_SPECIFIC_ERROR_CODE.WorkerLimit]: "WORKER_LIMIT",
};
const SB_SPECIFIC_ERROR_REASON = {
  [SB_SPECIFIC_ERROR_CODE.BootError]: "Worker failed to boot (please check logs)",
  [SB_SPECIFIC_ERROR_CODE.InvalidWorkerResponse]: "Function exited due to an error (please check logs)",
  [SB_SPECIFIC_ERROR_CODE.WorkerLimit]: "Worker failed to respond due to a resource limit (please check logs)",
};

const EXCLUDED_ENVS = ["HOME", "HOSTNAME", "PATH", "PWD"];
const JWT_SECRET = Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET")!;
const HOST_PORT = Deno.env.get("SUPABASE_INTERNAL_HOST_PORT")!;
const DEBUG = Deno.env.get("SUPABASE_INTERNAL_DEBUG") === "true";
const FUNCTIONS_CONFIG_STRING = Deno.env.get("SUPABASE_INTERNAL_FUNCTIONS_CONFIG")!;
const WALLCLOCK_LIMIT_SEC = parseInt(Deno.env.get("SUPABASE_INTERNAL_WALLCLOCK_LIMIT_SEC") ?? "");

const DENO_SB_ERROR_MAP = new Map([
  [Deno.errors.InvalidWorkerCreation, SB_SPECIFIC_ERROR_CODE.BootError],
  [Deno.errors.InvalidWorkerResponse, SB_SPECIFIC_ERROR_CODE.InvalidWorkerResponse],
  [Deno.errors.WorkerRequestCancelled, SB_SPECIFIC_ERROR_CODE.WorkerLimit],
]);

interface FunctionConfig {
  entrypointPath: string;
  importMapPath?: string;
  verifyJWT: boolean;
  staticFiles?: string[];
}

function getResponse(payload: unknown, status: number, customHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...customHeaders };
  let body: string | null = null;
  if (payload) {
    if (typeof payload === "object") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    } else if (typeof payload === "string") {
      headers["Content-Type"] = "text/plain";
      body = payload;
    }
  }
  return new Response(body, { status, headers });
}

const functionsConfig: Record<string, FunctionConfig> = (() => {
  try {
    const cfg = JSON.parse(FUNCTIONS_CONFIG_STRING);
    if (DEBUG) console.log("Functions config:", JSON.stringify(cfg, null, 2));
    return cfg;
  } catch (cause) {
    throw new Error("Failed to parse functions config", { cause });
  }
})();

function getAuthToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing authorization header");
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer") throw new Error(`Auth header is not 'Bearer {token}'`);
  return token;
}

async function verifyJWT(jwt: string): Promise<boolean> {
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error(e);
    return false;
  }
  return true;
}

Deno.serve({
  handler: async (req: Request) => {
    const url = new URL(req.url);
    const { pathname } = url;
    if (pathname === "/_internal/health") return getResponse({ message: "ok" }, STATUS_CODE.OK);
    if (pathname === "/_internal/metric") {
      // @ts-ignore EdgeRuntime global
      const metric = await EdgeRuntime.getRuntimeMetrics();
      return Response.json(metric);
    }

    const functionName = pathname.split("/")[1];
    if (!functionName || !(functionName in functionsConfig)) {
      return getResponse("Function not found", STATUS_CODE.NotFound);
    }
    if (req.method !== "OPTIONS" && functionsConfig[functionName].verifyJWT) {
      try {
        const token = getAuthToken(req);
        if (!(await verifyJWT(token))) return getResponse({ msg: "Invalid JWT" }, STATUS_CODE.Unauthorized);
      } catch (e) {
        console.error(e);
        return getResponse({ msg: String(e) }, STATUS_CODE.Unauthorized);
      }
    }

    const servicePath = posix.dirname(functionsConfig[functionName].entrypointPath);
    const memoryLimitMb = 256;
    const workerTimeoutMs = isFinite(WALLCLOCK_LIMIT_SEC) ? WALLCLOCK_LIMIT_SEC * 1000 : 400 * 1000;
    const envVars = Object.entries(Deno.env.toObject())
      .filter(([name]) => !EXCLUDED_ENVS.includes(name) && !name.startsWith("SUPABASE_INTERNAL_"));
    const absEntrypoint = posix.join(Deno.cwd(), functionsConfig[functionName].entrypointPath);
    const maybeEntrypoint = posix.toFileUrl(absEntrypoint).href;

    try {
      // @ts-ignore EdgeRuntime global
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath,
        memoryLimitMb,
        workerTimeoutMs,
        noModuleCache: false,
        importMapPath: functionsConfig[functionName].importMapPath,
        envVars,
        forceCreate: false,
        customModuleRoot: "",
        cpuTimeSoftLimitMs: 1000,
        cpuTimeHardLimitMs: 2000,
        decoratorType: "tc39",
        maybeEntrypoint,
        context: { useReadSyncFileAPI: true },
        staticPatterns: functionsConfig[functionName].staticFiles,
      });
      return await worker.fetch(req);
    } catch (e) {
      console.error(e);
      for (const [denoError, sbCode] of DENO_SB_ERROR_MAP.entries()) {
        if (denoError !== undefined && e instanceof denoError) {
          return getResponse({ code: SB_SPECIFIC_ERROR_TEXT[sbCode], message: SB_SPECIFIC_ERROR_REASON[sbCode] }, sbCode);
        }
      }
      return getResponse({ code: STATUS_TEXT[STATUS_CODE.InternalServerError], message: "Request failed due to an internal server error", trace: JSON.stringify((e as Error).stack) }, STATUS_CODE.InternalServerError);
    }
  },
  onListen: () => console.log(`Serving functions on http://127.0.0.1:${HOST_PORT}/functions/v1/<function-name> (Deno ${Deno.version.deno})`),
  onError: (e) => getResponse({ code: STATUS_TEXT[STATUS_CODE.InternalServerError], message: "Request failed due to an internal server error", trace: JSON.stringify((e as Error).stack) }, STATUS_CODE.InternalServerError),
});
