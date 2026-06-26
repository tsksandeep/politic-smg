// Typed client for the four coordinator endpoints (coordinator-api.md).
//
// Egress is ONE-WAY: the node only ever POSTs to the coordinator (Principle IV). There is no
// inbound channel, no remote code, no command execution — the coordinator hands out work items
// and the node returns normalised public data. Nodes authenticate with a tenant-scoped node
// token (Bearer), NEVER a user session (Principle II/IV).

import {
  HeartbeatRequest,
  HeartbeatResponse,
  RegisterResponse,
  SubmitPayload,
  SubmitResponse,
  WorkLeaseResponse,
} from "./types";

export class CoordinatorError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "CoordinatorError";
  }
}

function join(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

async function post<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(join(base, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    // The coordinator request must NOT carry any ambient browser credentials.
    credentials: "omit",
  });

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText;
    try {
      const j = await res.json();
      if (j?.error) code = j.error;
      if (j?.message) message = j.message;
    } catch {
      /* non-JSON error body */
    }
    throw new CoordinatorError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/** First-run registration with a tenant enrolment code. Returns the node token ONCE. */
export function register(
  base: string,
  enrolment_code: string,
  label: string
): Promise<RegisterResponse> {
  return post<RegisterResponse>(base, "/node-register", { enrolment_code, label });
}

/** Lease a small, rate-capped batch of work for this node's tenant. */
export function workLease(
  base: string,
  token: string,
  max_items = 10
): Promise<WorkLeaseResponse> {
  return post<WorkLeaseResponse>(base, "/work-lease", { max_items }, token);
}

/** Submit normalised public data for a leased assignment. No raw media bytes are ever sent. */
export function submit(
  base: string,
  token: string,
  payload: SubmitPayload
): Promise<SubmitResponse> {
  return post<SubmitResponse>(base, "/submit", payload, token);
}

/** Liveness + health. ip_status feeds the coverage-gap view; backoff_ms throttles this node. */
export function heartbeat(
  base: string,
  token: string,
  body: HeartbeatRequest
): Promise<HeartbeatResponse> {
  return post<HeartbeatResponse>(base, "/heartbeat", body, token);
}
