import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  defaultSpecSectionsList,
  loadSpecSectionsSettingsDraft,
  resetSpecSectionsToDefaults,
  saveSpecSections,
} from "../../lib/specSections";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

type TrackData = {
  sections: string[];
  usingCustom: boolean;
};

export function SpecSectionsSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [sections, setSections] = useState<string[]>([]);
  const [usingCustom, setUsingCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo<TrackData>(() => ({ sections, usingCustom }), [sections, usingCustom]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadSpecSectionsSettingsDraft(user.id)
      .then((draft) => {
        setSections(draft.sections);
        setUsingCustom(draft.usingCustom);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load spec sections"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const next = sections.map((s) => s.trim()).filter(Boolean);
    const err = await saveSpecSections(user.id, next);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    setSections(next);
    setUsingCustom(true);
    markSaved();
    setMessage("Spec section list saved.");
    return true;
  }, [markSaved, sections, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) {
          setSections(snapshot.sections);
          setUsingCustom(snapshot.usingCustom);
        }
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onReset() {
    if (!user?.id) return;
    if (!window.confirm("Reset to the built-in spec section list? This removes your custom list.")) return;
    setResetting(true);
    setMessage(null);
    setError(null);
    const err = await resetSpecSectionsToDefaults(user.id);
    setResetting(false);
    if (err) {
      setError(err);
      return;
    }
    const defaults = defaultSpecSectionsList();
    setSections(defaults);
    setUsingCustom(false);
    markSaved();
    setMessage("Restored built-in spec sections.");
  }

  if (loading) return <p className="muted">Loading spec sections…</p>;
  if (!user?.id) return null;

  return (
    <form className="stack" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      <div>
        <h2>Spec sections</h2>
        <p className="muted small">
          CSI / specification sections for paint, wallcovering, FRP, and SDS package dropdowns. Shared
          company-wide.
        </p>
        <p className="muted small">
          {usingCustom ? "Using your custom list." : "Using built-in defaults until you save a custom list."}{" "}
          {sections.length} section{sections.length === 1 ? "" : "s"}.
        </p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Spec section</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section, i) => (
              <tr key={`spec-${i}`}>
                <td>
                  <input
                    value={section}
                    disabled={readOnly}
                    onChange={(e) =>
                      setSections((list) => list.map((s, j) => (j === i ? e.target.value : s)))
                    }
                    placeholder="09 91 23 - Interior Painting"
                  />
                </td>
                <td className="paint-catalog-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={readOnly || i === 0}
                    onClick={() => setSections((list) => moveItem(list, i, i - 1))}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={readOnly || i === sections.length - 1}
                    onClick={() => setSections((list) => moveItem(list, i, i + 1))}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={readOnly}
                    onClick={() => setSections((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={readOnly}
          onClick={() => setSections((list) => [...list, ""])}
        >
          Add section
        </button>
        <button type="button" className="btn btn-ghost" disabled={readOnly || resetting} onClick={() => void onReset()}>
          {resetting ? "Resetting…" : "Reset to defaults"}
        </button>
        {!readOnly && (
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save spec sections"}
          </button>
        )}
      </div>
    </form>
  );
}
