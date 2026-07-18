import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  TRANSMITTAL_CONTENT_CATEGORIES,
  defaultTransmittalContentAutoOn,
  loadTransmittalContentAutoOnDraft,
  resetTransmittalContentAutoOn,
  saveTransmittalContentAutoOn,
  type TransmittalContentKey,
} from "../../lib/transmittalCategories";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

type TrackData = {
  keys: TransmittalContentKey[];
  usingCustom: boolean;
};

export function TransmittalCategoriesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [keys, setKeys] = useState<TransmittalContentKey[]>([]);
  const [usingCustom, setUsingCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo<TrackData>(() => ({ keys, usingCustom }), [keys, usingCustom]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadTransmittalContentAutoOnDraft(user.id)
      .then((draft) => {
        setKeys(draft.keys);
        setUsingCustom(draft.usingCustom);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load auto-on map"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveTransmittalContentAutoOn(user.id, keys);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    setUsingCustom(true);
    markSaved();
    setMessage("Transmittal auto-on categories saved.");
    return true;
  }, [keys, markSaved, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) {
          setKeys(snapshot.keys);
          setUsingCustom(snapshot.usingCustom);
        }
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  function toggleKey(key: TransmittalContentKey) {
    if (readOnly) return;
    setKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onReset() {
    if (!user?.id) return;
    if (!window.confirm("Reset to the default auto-on categories?")) return;
    setResetting(true);
    setMessage(null);
    setError(null);
    const err = await resetTransmittalContentAutoOn(user.id);
    setResetting(false);
    if (err) {
      setError(err);
      return;
    }
    setKeys(defaultTransmittalContentAutoOn());
    setUsingCustom(false);
    markSaved();
    setMessage("Restored default auto-on categories.");
  }

  if (loading) return <p className="muted">Loading transmittal categories…</p>;
  if (!user?.id) return null;

  return (
    <form className="stack" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      <div>
        <h2>Transmittal categories</h2>
        <p className="muted small">
          Choose which cover checkboxes may turn on automatically when packages are queued or
          enclosures suggest them. Unchecked categories still appear on the PDF and can be toggled
          manually on the Transmittal tab — they just won&apos;t auto-enable.
        </p>
        <p className="muted small">
          {usingCustom ? "Using your company auto-on list." : "Using built-in defaults."}
        </p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <div className="stack settings-transmittal-auto-list">
        {TRANSMITTAL_CONTENT_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="check">
            <input
              type="checkbox"
              checked={keys.includes(key)}
              disabled={readOnly}
              onChange={() => toggleKey(key)}
            />
            Auto-on: {label}
          </label>
        ))}
      </div>

      {!readOnly && (
        <div className="row-gap wrap">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={resetting || saving}
            onClick={() => void onReset()}
          >
            {resetting ? "Resetting…" : "Reset to defaults"}
          </button>
        </div>
      )}
    </form>
  );
}
