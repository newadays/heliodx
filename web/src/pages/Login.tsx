/** Email/password sign-in. Accounts are created by an admin; judges use the demo account they were given. */
import { sendPasswordResetEmail } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "~/auth/AuthContext";
import { ENV_CHIP } from "~/components/AppShell";
import { auth } from "~/firebase";

import "./login.css";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match an account.",
  "auth/wrong-password": "That email and password don't match an account.",
  "auth/user-not-found": "That email and password don't match an account.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/network-request-failed": "No connection. Check your network and try again.",
  "auth/invalid-email": "Enter a valid email address.",
};

export function LoginPage() {
  const { user, claims, loading, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const next = params.get("next") || "/worklist";

  if (!loading && user && claims.orgId) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(MESSAGES[code] ?? "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email first, then choose Forgot password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      // Same message either way: never reveal whether an account exists.
    }
    setNotice("If that email has an account, a reset link is on its way.");
  };

  return (
    <div className="app login">
      <main className="login__card card">
        <img src="/heliodx-lockup.png" alt="HelioDX" className="login__logo" />
        <h1>Sign in to HelioDX</h1>
        <p className="muted">Use the account your organization gave you. Judges: use the demo account you were sent.</p>
        <form onSubmit={(e) => void submit(e)} noValidate className="login__form">
          <label>
            Email
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@organization.org" />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="muted" role="status">{notice}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void reset()}>
            Forgot password?
          </button>
        </form>
        <span className="chip chip-env login__env">{ENV_CHIP}</span>
      </main>
    </div>
  );
}
