import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSupabaseConfigured } from "../lib/supabase";

export function LoginPage() {
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to="/projects" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const err =
      mode === "signin"
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (mode === "signup") {
      setMessage("Account created. Check your email if confirmation is required, then sign in.");
      setMode("signin");
      return;
    }
    navigate("/projects", { replace: true });
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>JobFlow</h1>
        <p className="muted">Sign in to manage projects and RFIs.</p>

        {!isSupabaseConfigured && (
          <div className="banner banner-warn">
            Copy <code>.env.example</code> to <code>.env.local</code> and add your Supabase URL
            and anon key, then restart <code>npm run dev</code>.
          </div>
        )}

        <form className="stack" onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </label>
          {error && <div className="banner banner-error">{error}</div>}
          {message && <div className="banner banner-ok">{message}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button type="button" className="link-btn" onClick={() => setMode("signup")}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" className="link-btn" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          )}
        </p>

        <p className="muted small">
          First time? Run <code>supabase/schema.sql</code> in your Supabase SQL Editor.
        </p>
      </div>
    </div>
  );
}
