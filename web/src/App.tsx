import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider, useAuth } from "~/auth/AuthContext";
import { ToastProvider } from "~/components/Toast";
import { LoginPage } from "~/pages/Login";

const WelcomePage = lazy(() => import("~/pages/Welcome"));
const WorklistPage = lazy(() => import("~/pages/Worklist"));
const StudyPage = lazy(() => import("~/pages/study/StudyPage"));
const ConsolePage = lazy(() => import("~/pages/console/ConsolePage"));
const EvalsPage = lazy(() => import("~/pages/evals/EvalsPage"));

/** Signed-in routes: sign in first, and only accounts bound to an organization get in. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, claims, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app" aria-busy="true" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!claims.orgId) {
    return (
      <div className="app center-page">
        <div className="card" style={{ padding: 28, maxWidth: 440 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Your account isn&apos;t set up yet</h1>
          <p className="muted">Ask your administrator to add you to an organization, then sign in again.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<div className="app" aria-busy="true" />}>
            <Routes>
              <Route path="/" element={<WelcomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/evals" element={<EvalsPage />} />
              <Route path="/evals/:taskId" element={<EvalsPage />} />
              <Route path="/worklist" element={<RequireAuth><WorklistPage /></RequireAuth>} />
              <Route path="/study/:caseId" element={<RequireAuth><StudyPage /></RequireAuth>} />
              <Route path="/console" element={<RequireAuth><ConsolePage /></RequireAuth>} />
              <Route path="/console/:caseId" element={<RequireAuth><ConsolePage /></RequireAuth>} />
              <Route path="/demo" element={<Navigate to="/worklist" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
