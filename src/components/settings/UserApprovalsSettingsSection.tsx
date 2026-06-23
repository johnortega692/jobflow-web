import { useCallback, useEffect, useState } from "react";
import { approveUser, loadPendingUsers, rejectUser, type PendingUser } from "../../lib/userApprovals";

function formatWhen(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UserApprovalsSettingsSection() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadPendingUsers();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setUsers([]);
      return;
    }
    setUsers(result.users);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onApprove(userId: string) {
    setBusyId(userId);
    setMessage(null);
    setError(null);
    const err = await approveUser(userId);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setMessage("User approved.");
    await reload();
  }

  async function onReject(user: PendingUser) {
    if (!window.confirm(`Reject and delete the account for ${user.email}?`)) return;
    setBusyId(user.userId);
    setMessage(null);
    setError(null);
    const err = await rejectUser(user.userId);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setMessage("User rejected.");
    await reload();
  }

  return (
    <section className="stack">
      <h2>User approvals</h2>
      <p className="muted small">
        New sign-ups cannot access JobFlow office features until approved here.
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}
      {loading ? (
        <p className="muted">Loading pending users…</p>
      ) : users.length === 0 ? (
        <p className="muted">No users waiting for approval.</p>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Signed up</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>{user.email || user.userId}</td>
                  <td className="muted">{formatWhen(user.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId === user.userId}
                        onClick={() => void onApprove(user.userId)}
                      >
                        {busyId === user.userId ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === user.userId}
                        onClick={() => void onReject(user)}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={() => void reload()} disabled={loading}>
        Refresh
      </button>
    </section>
  );
}
