import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function PendingApprovalPage() {
  const { user, signOut, refreshProfile, roleLoading } = useAuth();
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    await refreshProfile();
    setChecking(false);
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>Awaiting approval</h1>
        <p className="muted">
          Your JobFlow account{user?.email ? ` (${user.email})` : ""} was created successfully, but an
          administrator must approve it before you can access projects and office tools.
        </p>
        <p className="muted">
          You will be able to sign in once approval is complete. Field view remains available without
          login.
        </p>
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" disabled={checking || roleLoading} onClick={() => void checkAgain()}>
            {checking || roleLoading ? "Checking…" : "Check again"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
          <Link to="/field" target="_blank" rel="noopener noreferrer" className="link-btn">
            Open Field view
          </Link>
        </div>
      </div>
    </div>
  );
}
