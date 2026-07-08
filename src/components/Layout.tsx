import { Link, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { UserHeaderIdentity } from "./UserHeaderIdentity";
import { PendingApprovalPage } from "../pages/PendingApprovalPage";

export function Layout() {
  const { user, signOut, isAdmin, roleLoading } = useAuth();
  const { profile } = useLetterhead();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">JF</span>
          <div>
            <div className="brand-title">JobFlow</div>
          </div>
        </div>
        <span className="topbar-sep" aria-hidden="true" />
        <nav className="topnav">
          <Link to="/projects">Projects</Link>
          <Link to="/workload">Workload</Link>
          <Link to="/field" target="_blank" rel="noopener noreferrer">
            Field view
          </Link>
          <Link to="/brush-out-request">Brush-out request</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <div className="topbar-right">
          <UserHeaderIdentity profile={profile} email={user?.email} />
          {!roleLoading && isAdmin && <span className="topbar-admin-badge">Admin</span>}
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
  const { user, loading, roleLoading, isApproved } = useAuth();

  if (loading || roleLoading) {
    return (
      <div className="center-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isApproved) {
    return <PendingApprovalPage />;
  }

  return <Layout />;
}
