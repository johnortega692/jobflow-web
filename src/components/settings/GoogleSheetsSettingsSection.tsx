import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { patchUserSettings } from "../../lib/budgetLibrary";
import {
  DEFAULT_GOOGLE_URLS,
  GOOGLE_URL_FIELDS,
  normalizeGoogleUrls,
  validateGoogleUrls,
  type GoogleUrlKey,
} from "../../lib/googleSheetsConfig";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";

export function GoogleSheetsSettingsSection() {
  const { user } = useAuth();
  const [urls, setUrls] = useState<Record<GoogleUrlKey, string>>({ ...DEFAULT_GOOGLE_URLS });
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadPaintUserSettings(user.id)
      .then((data) => {
        setUrls(normalizeGoogleUrls(data.google_urls));
        setUserName(typeof data.user_name === "string" ? data.user_name : "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Google Sheets settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user?.id) return;
    const errMsg = validateGoogleUrls(urls);
    if (errMsg) {
      setError(errMsg);
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await patchUserSettings(user.id, {
      google_urls: urls,
      user_name: userName.trim(),
    });
    setSaving(false);
    if (err) setError(err);
    else setMessage("Google Apps Script URLs and user name saved.");
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
          Same Web App URLs as the desktop JobFlow Settings tab. Deploy each script with{" "}
          <strong>Anyone</strong> access. Used by the Google Sheets tab, BrushOuts, Paint Tracker sync,
          and wallcovering tracker.
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

      <section className="stack">
        <h2>Manpower user name</h2>
        <p className="muted small">
          Sent as <strong>submittedBy</strong> when you run Update Manpower or Test User Name on the
          Google Sheets tab (must match a name in the manpower sheet).
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
          {saving ? "Saving…" : "Save Google Sheets settings"}
        </button>
      </div>
    </form>
  );
}
