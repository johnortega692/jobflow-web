import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSupabaseConfigured } from "../lib/supabase";

export function LoginPage() {
  const { signIn, signUp, user, loading, roleLoading, isApproved } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!loading && !roleLoading && user && isApproved) {
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
      setMessage(
        "Account created. An administrator must approve your access before you can sign in to JobFlow office.",
      );
      setMode("signin");
      return;
    }
    navigate("/projects", { replace: true });
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>JobFlow</h1>

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
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((open) => !open)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <PasswordHideIcon /> : <PasswordShowIcon />}
              </button>
            </span>
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
      </div>
    </div>
  );
}

function PasswordShowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.2 12s3.6-7 9.8-7 9.8 7 9.8 7-3.6 7-9.8 7-9.8-7-9.8-7z"
      />
      <circle cx="12" cy="12" r="3" strokeWidth="1.75" />
    </svg>
  );
}

function PasswordHideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.1A10.8 10.8 0 0 1 12 5c6.2 0 9.8 7 9.8 7a16.7 16.7 0 0 1-3.3 3.8M6.1 6.1C3.9 7.6 2.2 12 2.2 12s3.6 7 9.8 7c1.5 0 2.9-.3 4.1-.9"
      />
    </svg>
  );
}
