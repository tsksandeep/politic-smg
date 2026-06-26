import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import "./index.css";

// "/" is the public, single-tenant gated-entry hero (Landing) and must render without Supabase
// credentials. The war-room app routes are lazy-loaded so the Supabase client (which requires
// VITE_SUPABASE_* env) isn't imported on "/". RequireAuth also pulls in the Supabase client,
// so it is lazy-loaded too.
const NarrativeBoard = lazy(() => import("./pages/NarrativeBoard"));
const NarrativeDetail = lazy(() => import("./pages/NarrativeDetail"));
const CoordinationBoard = lazy(() => import("./pages/CoordinationBoard"));
const Amplifiers = lazy(() => import("./pages/Amplifiers"));
const Alerts = lazy(() => import("./pages/Alerts"));
const AlertDetail = lazy(() => import("./pages/AlertDetail"));
const Coverage = lazy(() => import("./pages/Coverage"));
const Admin = lazy(() => import("./pages/Admin"));
const RequireAuth = lazy(() => import("./components/RequireAuth"));

// Branded splash for lazy-chunk / session-check loading (no white flash).
function Splash() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F5F6F8", color: "#64748B" }}>
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

// Wrap a protected element in the auth guard + lazy Suspense boundary. The real tenant boundary
// is RLS; this guard is the UX layer so analysts never see broken/empty protected pages.
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
      <Route path="/narratives" element={<Protected><NarrativeBoard /></Protected>} />
      <Route path="/narratives/:id" element={<Protected><NarrativeDetail /></Protected>} />
      <Route path="/coordination" element={<Protected><CoordinationBoard /></Protected>} />
      <Route path="/amplifiers" element={<Protected><Amplifiers /></Protected>} />
      <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
      <Route path="/alerts/:id" element={<Protected><AlertDetail /></Protected>} />
      <Route path="/coverage" element={<Protected><Coverage /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      {/* Legacy entry points redirect to the primary narrative board. */}
      <Route path="/board" element={<Navigate to="/narratives" replace />} />
      <Route path="*" element={<Navigate to="/narratives" replace />} />
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
