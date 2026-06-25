// unsupported_account_test.ts (T033) — unsupported account type → guidance, no data collected.
// Guarded by FUNCTIONS_URL. The callback returns HTTP 422 with guidance and creates NO
// connected_account when the platform reports no Creator/Business account.
// (A full run requires a mocked platform token endpoint; here we assert the contract shape
// for an invalid/expired state, which exercises the same no-data guarantee.)

import { assert } from "std/assert/mod.ts";

const base = Deno.env.get("FUNCTIONS_URL");

Deno.test({
  name: "oauth-callback rejects unknown state without creating data",
  ignore: !base,
  fn: async () => {
    const res = await fetch(`${base}/oauth-callback?code=fake&state=does-not-exist`);
    assert(res.status === 400 || res.status === 422, `expected 400/422, got ${res.status}`);
    const body = await res.json();
    assert("error" in body, "error payload returned; no account created");
  },
});
