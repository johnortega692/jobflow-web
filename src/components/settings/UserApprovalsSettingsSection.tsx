import { useCallback, useEffect, useState } from "react";
import {
  approveUser,
  loadApprovedUsers,
  loadPendingUsers,
  rejectUser,
  setUserJobRole,
  type ApprovedUser,
  type PendingUser,
} from "../../lib/userApprovals";
import { JOB_ROLE_OPTIONS, normalizeJobRoleSlug } from "../../types/jobRoles";
import { useAuth } from "../../contexts/AuthContext";

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
  const { user, refreshProfile } = useAuth();
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<ApprovedUser[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reloadPending = useCallback(async () => {
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

  const reloadApproved = useCallback(async () => {
    setApprovedLoading(true);
    const result = await loadApprovedUsers();
    setApprovedLoading(false);
    if (result.error) {
      setError(result.error);
      setApprovedUsers([]);
      setRoleDrafts({});
      return;
    }
    setApprovedUsers(result.users);
    setRoleDrafts(
      Object.fromEntries(result.users.map((user) => [user.userId, normalizeJobRoleSlug(user.jobRole)])),
    );
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([reloadPending(), reloadApproved()]);
  }, [reloadApproved, reloadPending]);

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

  async function onSaveRole(approvedUser: ApprovedUser) {
    const nextRole = normalizeJobRoleSlug(roleDrafts[approvedUser.userId] ?? "");
    if (nextRole === normalizeJobRoleSlug(approvedUser.jobRole)) return;
    setBusyId(approvedUser.userId);
    setMessage(null);
    setError(null);
    const err = await setUserJobRole(approvedUser.userId, nextRole);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setMessage(`Role updated for ${approvedUser.email || approvedUser.userId}.`);
    if (user?.id === approvedUser.userId) {
      await refreshProfile();
    }
    await reloadApproved();
  }

  return (
    <div className="stack">
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
      </section>

      <section className="stack">
        <h2>Team roles</h2>
        <p className="muted small">
          Informational office roles shown on each user&apos;s profile. Only admins can change these.
        </p>
        {approvedLoading ? (
          <p className="muted">Loading approved users…</p>
        ) : approvedUsers.length === 0 ? (
          <p className="muted">No approved users yet.</p>
        ) : (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Approved</th>
                  <th>Role</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {approvedUsers.map((user) => {
                  const draft = roleDrafts[user.userId] ?? normalizeJobRoleSlug(user.jobRole);
                  const dirty = draft !== normalizeJobRoleSlug(user.jobRole);
                  return (
                    <tr key={user.userId}>
                      <td>{user.email || user.userId}</td>
                      <td className="muted">{formatWhen(user.approvedAt)}</td>
                      <td>
                        <select
                          value={draft}
                          disabled={busyId === user.userId}
                          onChange={(e) =>
                            setRoleDrafts((prev) => ({ ...prev, [user.userId]: e.target.value }))
                          }
                        >
                          {JOB_ROLE_OPTIONS.map((option) => (
                            <option key={option.value || "none"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!dirty || busyId === user.userId}
                            onClick={() => void onSaveRole(user)}
                          >
                            {busyId === user.userId ? "…" : "Save"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <button type="button" className="btn btn-ghost" onClick={() => void reload()} disabled={loading}>
        Refresh
      </button>
    </div>
  );
}
