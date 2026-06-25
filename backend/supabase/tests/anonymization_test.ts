// anonymization_test.ts (T021a) — store-side anonymization guarantees (FR-008, Principle III).
// The unit portion runs anywhere (sets a test key, dynamically imports hash.ts). The DB
// assertion is guarded by DATABASE_URL and skipped when no local db is available.

import { assert, assertEquals, assertNotEquals } from "std/assert/mod.ts";

Deno.test("commenter hash is deterministic, keyed, and not the raw handle", async () => {
  Deno.env.set("COMMENTER_HASH_KEY", "test-key-for-ci");
  const { hashCommenter } = await import("../shared/hash.ts");

  const handle = "real_citizen_handle";
  const h1 = await hashCommenter(handle);
  const h2 = await hashCommenter(handle);

  assertEquals(h1, h2, "same handle → same hash (enables coordination detection)");
  assertNotEquals(h1, handle, "hash must not equal the raw handle");
  assert(!h1.includes(handle), "hash must not contain the raw handle");
  assert(/^[0-9a-f]{64}$/.test(h1), "hash is a 64-char hex HMAC-SHA256 digest");
});

Deno.test({
  name: "comment table never persists a raw commenter handle column",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      const cols = await sql`
        select column_name from information_schema.columns
        where table_name = 'comment'`;
      const names = (cols as unknown as Array<{ column_name: string }>).map((c) => c.column_name);
      assert(names.includes("commenter_hash"), "comment has commenter_hash");
      assert(
        !names.some((n: string) => /handle|username|author|commenter_name/i.test(n)),
        "comment has NO raw-identity column",
      );
    } finally {
      await sql.end();
    }
  },
});
