import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { patchUserSettings } from "../../lib/budgetLibrary";
import {
  DEFAULT_GOOGLE_URLS,
  GOOGLE_URL_FIELDS,
  normalizeGoogleUrls,
  validateGoogleUrls,
  type GoogleUrlKey,
} from "../../lib/googleSheetsConfig";
import { loadOrgGoogleUrls, saveOrgGoogleUrls } from "../../lib/orgSettings";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";

export function GoogleSheetsSettingsSection({ onDirtyChange, onBindActions }: SettingsSectionBindings) {
  const { user, isAdmin } = useAuth();
  const [urls, setUrls] = useState<Record<GoogleUrlKey, string>>({ ...DEFAULT_GOOGLE_URLS });
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo(
    () => (isAdmin ? { urls, userName } : { userName }),
    [isAdmin, urls, userName],
  );
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void Promise.all([loadOrgGoogleUrls(), loadPaintUserSettings(user.id)])
      .then(([orgUrls, personal]) => {
        setUrls(orgUrls);
        setUserName(typeof personal.user_name === "string" ? personal.user_name : "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Google Sheets settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (isAdmin) {
      const errMsg = validateGoogleUrls(urls);
      if (errMsg) {
        setError(errMsg);
        return false;
      }
    }
    setSaving(true);
    setMessage(null);
    setError(null);

    if (isAdmin) {
      const orgErr = await saveOrgGoogleUrls(urls, user.id);
      if (orgErr) {
        setSaving(false);
        setError(orgErr);
        return false;
      }
    }

    const userErr = await patchUserSettings(user.id, {
      user_name: userName.trim(),
    });
    setSaving(false);
    if (userErr) {
      setError(userErr);
      return false;
    }
    markSaved();
    setMessage(
      isAdmin
        ? "Shared Google Apps Script URLs and your manpower user name saved."
        : "Manpower user name saved.",
    );
    return true;
  }, [isAdmin, markSaved, urls, user?.id, userName]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (!snapshot) return;
        if (isAdmin && "urls" in snapshot) {
          setUrls(snapshot.urls as Record<GoogleUrlKey, string>);
        }
        setUserName(snapshot.userName);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, isAdmin]);

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
          {isAdmin ? (
            <>
              Shared for everyone in JobFlow. Deploy each script with <strong>Anyone</strong> access.
              Used by the startup checklist, BrushOuts, and Gmail send via the Dashboard web app.
            </>
          ) : (
            <>
              Shared company URLs — only an admin can change these. You can still set your own manpower
              user name below.
            </>
          )}
        </p>
        {GOOGLE_URL_FIELDS.map(({ key, title, hint }) => (
          <label key={key}>
            {title}
            <input
              type="url"
              value={urls[key]}
              readOnly={!isAdmin}
              disabled={!isAdmin}
              onChange={(e) => setUrls((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder="https://script.google.com/macros/s/…/exec"
            />
            <span className="muted small">{hint}</span>
          </label>
        ))}
      </section>

      <section className="stack">
        <h2>Manpower user name</h2>
        <p className="muted small">
          Sent as <strong>submittedBy</strong> when you run Update Manpower or Test User Name on the
          dashboard (must match a name in the manpower sheet).
        </p>
        <label>
          User name
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Ortega"
          />
        </label>
      </section>

      <div className="row-gap">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : isAdmin ? "Save Google Sheets settings" : "Save user name"}
        </button>
      </div>
    </form>
  );
}
