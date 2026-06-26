// useRole — resolve the signed-in user's tenant role (admin | analyst) for least-privilege UI
// gating (FR-016). RLS already enforces the real boundary at the database; this hook only decides
// which controls to render. A user belongs to exactly one tenant, so tenant_user returns one row.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Role = "admin" | "analyst";

export function useRole(): { role: Role | null; loading: boolean } {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      // No tenant_id filter — RLS returns only the caller's own tenant_user row.
      const { data } = await supabase.from("tenant_user").select("role").maybeSingle();
      if (!active) return;
      setRole((data?.role as Role) ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { role, loading };
}
