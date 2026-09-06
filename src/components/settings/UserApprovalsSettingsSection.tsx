import { useCallback, useEffect, useState } from "react";
import {
  GRANTABLE_SETTINGS_TABS,
  SETTINGS_MENU_GROUP_META,
  defaultGrantableSettingsTabIds,
  effectiveGrantableSettingsTabs,
  settingsMenuGroup,
  type GrantableSettingsTabId,
} from "../../config/settingsTabs";
import {
  approveUser,
  loadApprovedUsers,
  loadPendingUsers,
  rejectUser,
  setUserJobRole,
  setUserSettingsTabs,
  setUserAppRole,
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

function sameTabIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

export function UserApprovalsSettingsSection() {
  const { user, refreshProfile } = useAuth();
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<ApprovedUser[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [tabDrafts, setTabDrafts] = useState<Record<string, GrantableSettingsTabId[]>>({});
  const [adminDrafts, setAdminDrafts] = useState<Record<string, boolean>>({});
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
      setTabDrafts({});
      setAdminDrafts({});
      return;
    }
    setApprovedUsers(result.users);
    setRoleDrafts(
      Object.fromEntries(result.users.map((row) => [row.userId, normalizeJobRoleSlug(row.jobRole)])),
    );
    setTabDrafts(
      Object.fromEntries(
        result.users.map((row) => [row.userId, effectiveGrantableSettingsTabs(row.settingsTabs)]),
      ),
    );
    setAdminDrafts(Object.fromEntries(result.users.map((row) => [row.userId, row.appRole === "admin"])));
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

  async function onReject(pending: PendingUser) {
    if (!window.confirm(`Reject and delete the account for ${pending.email}?`)) return;
    setBusyId(pending.userId);
    setMessage(null);
    setError(null);
    const err = await rejectUser(pending.userId);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setMessage("User rejected.");
    await reload();
  }

  function toggleTab(userId: string, tabId: GrantableSettingsTabId) {
    setTabDrafts((prev) => {
      const current = prev[userId] ?? defaultGrantableSettingsTabIds();
      const next = current.includes(tabId)
        ? current.filter((id) => id !== tabId)
        : [...current, tabId];
      return { ...prev, [userId]: next };
    });
  }

  async function onSaveUser(approvedUser: ApprovedUser) {
    const nextRole = normalizeJobRoleSlug(roleDrafts[approvedUser.userId] ?? "");
    const nextTabs = tabDrafts[approvedUser.userId] ?? defaultGrantableSettingsTabIds();
    const nextIsAdmin = Boolean(adminDrafts[approvedUser.userId]);
    const wasAdmin = approvedUser.appRole === "admin";
    const roleDirty = nextRole !== normalizeJobRoleSlug(approvedUser.jobRole);
    const adminDirty = nextIsAdmin !== wasAdmin;
    const tabsDirty =
      !nextIsAdmin && !sameTabIds(nextTabs, effectiveGrantableSettingsTabs(approvedUser.settingsTabs));
    if (!roleDirty && !tabsDirty && !adminDirty) return;

    if (adminDirty) {
      const ok = window.confirm(
        nextIsAdmin
          ? `Give ${approvedUser.email || "this user"} JobFlow admin access? They will be able to edit company settings for everyone.`
          : `Remove JobFlow admin access from ${approvedUser.email || "this user"}? They will only see the Settings sections you grant.`,
      );
      if (!ok) return;
    }

    setBusyId(approvedUser.userId);
    setMessage(null);
    setError(null);
    const errors: string[] = [];
    if (adminDirty && !nextIsAdmin) {
      const err = await setUserAppRole(approvedUser.userId, false);
      if (err) errors.push(err);
    }
    if (!errors.length && roleDirty) {
      const err = await setUserJobRole(approvedUser.userId, nextRole);
      if (err) errors.push(err);
    }
    if (!errors.length && tabsDirty) {
      const err = await setUserSettingsTabs(approvedUser.userId, nextTabs);
      if (err) errors.push(err);
    }
    if (!errors.length && adminDirty && nextIsAdmin) {
      const err = await setUserAppRole(approvedUser.userId, true);
      if (err) errors.push(err);
    }
    setBusyId(null);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setMessage(`Updated ${approvedUser.email || approvedUser.userId}.`);
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
                {users.map((pending) => (
                  <tr key={pending.userId}>
                    <td>{pending.email || pending.userId}</td>
                    <td className="muted">{formatWhen(pending.createdAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyId === pending.userId}
                          onClick={() => void onApprove(pending.userId)}
                        >
                          {busyId === pending.userId ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === pending.userId}
                          onClick={() => void onReject(pending)}
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
          Informational office roles shown on each user&apos;s profile. Use <strong>Admin access</strong> to
          give another person full company Settings (same as your Admin badge). You cannot change your
          own admin access or remove the last admin. Regular users only see the Settings sections you
          check below. Profile & letterhead is always available.
        </p>
        {approvedLoading ? (
          <p className="muted">Loading approved users…</p>
        ) : approvedUsers.length === 0 ? (
          <p className="muted">No approved users yet.</p>
        ) : (
          <div className="stack settings-user-access-list">
            {approvedUsers.map((approvedUser) => {
              const draft = roleDrafts[approvedUser.userId] ?? normalizeJobRoleSlug(approvedUser.jobRole);
              const tabDraft =
                tabDrafts[approvedUser.userId] ?? effectiveGrantableSettingsTabs(approvedUser.settingsTabs);
              const adminDraft = adminDrafts[approvedUser.userId] ?? approvedUser.appRole === "admin";
              const wasAdmin = approvedUser.appRole === "admin";
              const isSelf = user?.id === approvedUser.userId;
              const savedAdminCount = approvedUsers.filter((row) => row.appRole === "admin").length;
              const isLastAdmin = wasAdmin && savedAdminCount <= 1;
              const adminLocked = isSelf || isLastAdmin;
              const roleDirty = draft !== normalizeJobRoleSlug(approvedUser.jobRole);
              const adminDirty = adminDraft !== wasAdmin;
              const tabsDirty =
                !adminDraft &&
                !sameTabIds(tabDraft, effectiveGrantableSettingsTabs(approvedUser.settingsTabs));
              const dirty = roleDirty || tabsDirty || adminDirty;
              return (
                <div key={approvedUser.userId} className="card stack settings-user-access-card">
                  <div className="settings-user-access-head">
                    <div>
                      <p className="settings-user-access-email">{approvedUser.email || approvedUser.userId}</p>
                      <p className="muted small" style={{ margin: 0 }}>
                        Approved {formatWhen(approvedUser.approvedAt)}
                        {wasAdmin ? " · Admin" : ""}
                        {isSelf ? " · you" : ""}
                      </p>
                    </div>
                    <div className="settings-user-access-role">
                      <label className="checkbox-row settings-user-admin-toggle">
                        <input
                          type="checkbox"
                          checked={adminDraft}
                          disabled={busyId === approvedUser.userId || adminLocked}
                          onChange={(e) =>
                            setAdminDrafts((prev) => ({ ...prev, [approvedUser.userId]: e.target.checked }))
                          }
                        />
                        Admin access
                      </label>
                      <label>
                        Role
                        <select
                          value={draft}
                          disabled={busyId === approvedUser.userId}
                          onChange={(e) =>
                            setRoleDrafts((prev) => ({ ...prev, [approvedUser.userId]: e.target.value }))
                          }
                        >
                          {JOB_ROLE_OPTIONS.map((option) => (
                            <option key={option.value || "none"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!dirty || busyId === approvedUser.userId}
                        onClick={() => void onSaveUser(approvedUser)}
                      >
                        {busyId === approvedUser.userId ? "…" : "Save"}
                      </button>
                    </div>
                  </div>

                  {isSelf ? (
                    <p className="muted small" style={{ margin: 0 }}>
                      You cannot change your own admin access.
                    </p>
                  ) : isLastAdmin ? (
                    <p className="muted small" style={{ margin: 0 }}>
                      This is the last admin, so admin access cannot be removed.
                    </p>
                  ) : adminDraft ? (
                    <p className="muted small" style={{ margin: 0 }}>
                      This account is an admin and always has every Settings section.
                    </p>
                  ) : (
                    <div className="stack">
                      <div className="settings-user-access-tools">
                        <p className="muted small" style={{ margin: 0 }}>
                          Settings access
                        </p>
                        <div className="row-gap wrap">
                          <button
                            type="button"
                            className="link-btn small"
                            disabled={busyId === approvedUser.userId}
                            onClick={() =>
                              setTabDrafts((prev) => ({
                                ...prev,
                                [approvedUser.userId]: defaultGrantableSettingsTabIds(),
                              }))
                            }
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="link-btn small"
                            disabled={busyId === approvedUser.userId}
                            onClick={() =>
                              setTabDrafts((prev) => ({ ...prev, [approvedUser.userId]: [] }))
                            }
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="settings-user-access-grid">
                        {(["user", "admin"] as const).map((groupId) => {
                          const rows = GRANTABLE_SETTINGS_TABS.filter(
                            (tab) => settingsMenuGroup(tab) === groupId,
                          );
                          if (!rows.length) return null;
                          return (
                            <div key={groupId} className="settings-user-access-group">
                              <p className="settings-nav-group-label">
                                {SETTINGS_MENU_GROUP_META[groupId].label}
                              </p>
                              {rows.map((tab) => (
                                <label key={tab.id} className="check">
                                  <input
                                    type="checkbox"
                                    checked={tabDraft.includes(tab.id)}
                                    disabled={busyId === approvedUser.userId}
                                    onChange={() => toggleTab(approvedUser.userId, tab.id)}
                                  />
                                  {tab.label}
                                </label>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <button type="button" className="btn btn-ghost" onClick={() => void reload()} disabled={loading}>
        Refresh
      </button>
    </div>
  );
}
