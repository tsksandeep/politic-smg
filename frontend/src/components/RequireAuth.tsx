// RequireAuth — gate the war-room routes behind a real Supabase session (FR-016).
// Unauthenticated users are redirected to the public landing hero. RLS is the actual data
// boundary; this guard is the UX layer so analysts never see broken/empty protected pages.

import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../services/supabase";

type AuthState = "checking" | "in" | "out";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let active = true;
    // A magic-link return lands on this route with the token in the URL hash; supabase-js
    // processes it asynchronously and fires onAuthStateChange. Don't redirect out while that
    // is still in flight, or we'd bounce the user before the session is established.
    const authInFlight = window.location.hash.includes("access_token");

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(session ? "in" : "out");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setState("in");
      else if (!authInFlight) setState("out");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state === "checking") return null;
  if (state === "out") return <Navigate to="/" replace />;
  return <>{children}</>;
}
