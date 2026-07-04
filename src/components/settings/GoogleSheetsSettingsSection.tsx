import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  DEFAULT_GOOGLE_URLS,
  GOOGLE_URL_FIELDS,
  validateGoogleUrls,
  type GoogleUrlKey,
} from "../../lib/googleSheetsConfig";
import { loadOrgGoogleUrls, saveOrgGoogleUrls } from "../../lib/orgSettings";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";

export function GoogleSheetsSettingsSection({ onDirtyChange, onBindActions }: SettingsSectionBindings) {
  const { user } = useAuth();
  const [urls, setUrls] = useState<Record<GoogleUrlKey, string>>({ ...DEFAULT_GOOGLE_URLS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo(() => ({ urls }), [urls]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadOrgGoogleUrls()
      .then((orgUrls) => {
        setUrls(orgUrls);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Google Sheets settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    const errMsg = validateGoogleUrls(urls);
    if (errMsg) {
      setError(errMsg);
      return false;
    }
    setSaving(true);
    setMessage(null);
    setError(null);

    const orgErr = await saveOrgGoogleUrls(urls, user.id);
    setSaving(false);
    if (orgErr) {
      setError(orgErr);
      return false;
    }
    markSaved();
    setMessage("Shared Google Apps Script URLs saved.");
    return true;
  }, [markSaved, urls, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (!snapshot) return;
        setUrls(snapshot.urls as Record<GoogleUrlKey, string>);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  if (loading) return <p className="muted">Loading Google Sheets settings…</p>;

  return (
    <form className="stack google-sheets-settings" onSubmit={(e) => void onSave(e)}>
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>Google Apps Script URLs</h2>
        <p className="muted small">
          Shared for everyone in JobFlow. Deploy each script with <strong>Anyone</strong> access.
          Dashboard URL powers scheduled tracker emails; Field Request Order URL powers Field Tools order emails.
        </p>
        {GOOGLE_URL_FIELDS.map(({ key, title, hint }) => (
          <label key={key}>
            {title}
            <input
              type="url"
              value={urls[key]}
              onChange={(e) => setUrls((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder="https://script.google.com/macros/s/…/exec"
            />
            <span className="muted small">{hint}</span>
          </label>
        ))}
      </section>

      <div className="row-gap">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save Google Sheets settings"}
        </button>
      </div>
    </form>
  );
}
