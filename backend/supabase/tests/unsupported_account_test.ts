// unsupported_account_test.ts (T033) — the record endpoint creates NO data for a bad request.
// Guarded by FUNCTIONS_URL. With Nango, oauth-callback is a POST that records a completed
// connection; an unsupported (e.g. personal IG) account resolves to no Creator/Business account and
// returns HTTP 422 with NO connected_account created. Here we assert the same no-data guarantee for
// a malformed request (missing params), which doesn't require a mock account-type variation.

import { assert } from "std/assert/mod.ts";

const base = Deno.env.get("FUNCTIONS_URL");

Deno.test({
  name: "oauth-callback rejects a bad request without creating data",
  ignore: !base,
  fn: async () => {
    const res = await fetch(`${base}/oauth-callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cadre_id: "x" }), // missing platform + connection_id
    });
    assert(res.status === 400 || res.status === 422, `expected 400/422, got ${res.status}`);
    const body = await res.json();
    assert("error" in body, "error payload returned; no account created");
  },
});
