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
const Onboarding = lazy(() => import("./pages/Onboarding"));
const RequireAuth = lazy(() => import("./components/RequireAuth"));

// Wrap a protected element in the auth guard + lazy Suspense boundary.
function Protected({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
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
