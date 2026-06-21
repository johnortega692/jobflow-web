import { Link, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { profileDisplayLabel } from "../lib/userProfile";

export function Layout() {
  const { user, signOut } = useAuth();
  const { profile } = useLetterhead();
  const displayUser = profileDisplayLabel(profile) || profile.name.trim() || user?.email || "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">JF</span>
          <div>
            <div className="brand-title">JobFlow</div>
          </div>
        </div>
        <nav className="topnav">
          <Link to="/projects">Projects</Link>
          <Link to="/field" target="_blank" rel="noopener noreferrer">
            Field view
          </Link>
          <Link to="/brush-out-request">Brush-out request</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <div className="topbar-right">
          <span className="user-email" title={user?.email ?? undefined}>
            {displayUser}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Layout />;
}
