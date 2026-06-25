import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import "./index.css";

// "/" is the public, single-tenant gated-entry hero (Landing) and must render
// without Supabase credentials. The war-room app routes are lazy-loaded so the
// Supabase client (which requires VITE_SUPABASE_* env) isn't imported on "/".
// RequireAuth also pulls in the Supabase client, so it is lazy-loaded too.
const Board = lazy(() => import("./pages/Board"));
const AlertDetail = lazy(() => import("./pages/AlertDetail"));
const NarrativeDetail = lazy(() => import("./pages/NarrativeDetail"));
const CadreDetail = lazy(() => import("./pages/CadreDetail"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const RequireAuth = lazy(() => import("./components/RequireAuth"));

// Branded dark splash for lazy-chunk / session-check loading (no white flash).
function Splash() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#F5F6F8",
        color: "#64748B",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Clash Display', ui-sans-serif, system-ui, sans-serif", fontSize: 22, fontWeight: 600, color: "#0F172A", letterSpacing: "-0.02em" }}>
          Politic
        </div>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 8 }}>
          Establishing secure session…
        </div>
      </div>
    </div>
  );
}

// Wrap a protected element in the auth guard + lazy Suspense boundary.
function Protected({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Splash />}>
      <RequireAuth>{children}</RequireAuth>
    </Suspense>
  );
}

function Shell() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/board" element={<Protected><Board /></Protected>} />
      <Route path="/alerts/:id" element={<Protected><AlertDetail /></Protected>} />
      <Route path="/narratives/:id" element={<Protected><NarrativeDetail /></Protected>} />
      <Route path="/cadres/:id" element={<Protected><CadreDetail /></Protected>} />
      <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>,
);
