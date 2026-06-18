import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">JF</span>
          <div>
            <div className="brand-title">JobFlow</div>
            <div className="brand-sub">Web preview</div>
          </div>
        </div>
        <nav className="topnav">
          <a href="/projects">Projects</a>
        </nav>
        <div className="topbar-right">
          <span className="user-email">{user?.email}</span>
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
