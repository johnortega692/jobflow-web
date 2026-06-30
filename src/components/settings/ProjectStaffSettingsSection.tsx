import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  defaultProjectStaffSettings,
  emptyStaffContact,
  loadProjectStaffSettings,
  saveProjectStaffSettings,
  staffContactLabel,
} from "../../lib/projectStaffSettings";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { ProjectStaffSettings, StaffContact } from "../../types/staffContacts";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

type StaffTableProps = {
  title: string;
  description: string;
  contacts: StaffContact[];
  readOnly: boolean;
  onChange: (next: StaffContact[]) => void;
  addLabel: string;
};

function StaffContactTable({ title, description, contacts, readOnly, onChange, addLabel }: StaffTableProps) {
  function patchContact(index: number, patch: Partial<StaffContact>) {
    onChange(contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <section className="stack">
      <h2>{title}</h2>
      <p className="muted small">{description}</p>
      <div className="paint-settings-table-wrap">
        <table className="paint-settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              {!readOnly ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {!contacts.length ? (
              <tr>
                <td colSpan={readOnly ? 2 : 3} className="muted small">
                  No contacts yet.
                </td>
              </tr>
            ) : (
              contacts.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    {readOnly ? (
                      c.name.trim() || "—"
                    ) : (
                      <input value={c.name} onChange={(e) => patchContact(i, { name: e.target.value })} />
                    )}
                  </td>
                  <td>
                    {readOnly ? (
                      c.email.trim() || "—"
                    ) : (
                      <input
                        type="email"
                        value={c.email}
                        onChange={(e) => patchContact(i, { email: e.target.value })}
                      />
                    )}
                  </td>
                  {!readOnly ? (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onChange(contacts.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...contacts, emptyStaffContact()])}>
          {addLabel}
        </button>
      ) : null}
      {contacts.length > 0 && readOnly ? (
        <ul className="muted small stack-tight">
          {contacts.map((c) => (
            <li key={c.id}>{staffContactLabel(c)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function ProjectStaffSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [data, setData] = useState<ProjectStaffSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = data ?? defaultProjectStaffSettings();
  const ready = !loading && data !== null;
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    setLoading(true);
    void loadProjectStaffSettings()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load project staff"))
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data || readOnly) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveProjectStaffSettings(data, user.id);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    markSaved();
    setMessage("Project staff saved.");
    return true;
  }, [data, markSaved, readOnly, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) setData(snapshot);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  if (loading) return <p className="muted">Loading project staff…</p>;

  return (
    <div className="stack">
      {readOnly ? <SharedSettingsNotice /> : null}
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <p className="muted small">
        Office PMs appear as an optional dropdown when creating a new project.{" "}
        <strong>Supers and foremen are managed in Field Tools</strong> — add or edit them in the{" "}
        <Link to="/field" target="_blank" rel="noopener noreferrer">
          Field app
        </Link>{" "}
        admin panel (same profiles used for PIN login and field orders).
      </p>

      <StaffContactTable
        title="Project managers"
        description="ICBI PMs — optional on new projects; fills Job setup ICBI PM. Users with a PM job title or a matching roster name default to their profile."
        contacts={trackData.project_staff_pms}
        readOnly={readOnly}
        addLabel="Add PM"
        onChange={(project_staff_pms) => setData((d) => (d ? { ...d, project_staff_pms } : d))}
      />

      {!readOnly ? (
        <div className="row-gap">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save PM list"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
