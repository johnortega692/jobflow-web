import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { countOpenOverdueNotes, listAllProjectNotes, subscribeProjectNotesChanged } from "../lib/projectNotes";
import { UserAccountMenu } from "./UserAccountMenu";
import { PendingApprovalPage } from "../pages/PendingApprovalPage";

function useOverdueNoteCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rows = await listAllProjectNotes();
        if (!cancelled) setCount(countOpenOverdueNotes(rows));
      } catch {
        if (!cancelled) setCount(0);
      }
    }
    void load();
    const unsubscribe = subscribeProjectNotesChanged(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return count;
}

export function Layout() {
  const { user, signOut, isAdmin, roleLoading } = useAuth();
  const { profile } = useLetterhead();
  const overdueNotes = useOverdueNoteCount();

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
          <NavLink to="/notes" end>
            Notes
            {overdueNotes > 0 ? (
              <span className="topnav-badge">
                {overdueNotes}
                <span className="sr-only"> overdue</span>
              </span>
            ) : null}
          </NavLink>
        </nav>
        <div className="topbar-right">
          <UserAccountMenu profile={profile} email={user?.email} onSignOut={() => signOut()} />
          {!roleLoading && isAdmin && <span className="topbar-admin-badge">Admin</span>}
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
