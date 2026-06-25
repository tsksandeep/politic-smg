// warroom_api_test.ts (T021) — contract test for the war-room read surfaces.
// Asserts: board/detail expose confidence, and detail NEVER exposes commenter identity (FR-008).
// Guarded by FUNCTIONS_URL + STAFF_JWT (a running supabase + an authenticated staff token).

import { assert } from "std/assert/mod.ts";

const base = Deno.env.get("FUNCTIONS_URL");
const jwt = Deno.env.get("STAFF_JWT");
const alertId = Deno.env.get("TEST_ALERT_ID");

Deno.test({
  name: "alert-detail includes confidence and no commenter identity",
  ignore: !(base && jwt && alertId),
  fn: async () => {
    const res = await fetch(`${base}/alert-detail?id=${alertId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    assert(res.ok, `alert-detail returned ${res.status}`);
    const body = await res.json();

    assert("confidence_signal" in body, "detail carries a confidence signal (Principle V)");
    assert(
      body.labels?.is_signal_not_verdict === true,
      "detail labels output as signal-not-verdict",
    );

    const serialized = JSON.stringify(body);
    assert(
      !/commenter_hash|author|username|handle/i.test(serialized),
      "detail payload exposes no commenter identity field",
    );
    for (const c of body.example_comments ?? []) {
      assert(!("commenter_hash" in c), "example comments omit commenter_hash");
    }
  },
});
