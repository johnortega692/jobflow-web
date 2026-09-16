import { FormEvent, useCallback, useEffect, useState } from "react";
import { patchOrgSettings } from "../../lib/budgetLibrary";
import { emailAddressWarning } from "../../lib/emailAddressWarning";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import {
  BillingDueDigestSection,
  FollowUpRemindersSection,
  ScheduledEmailSection,
  usePaintSettingsData,
  WeeklyDigestSection,
} from "./paintSettingsShared";

export function TrackerSchedulesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const {
    user,
    data,
    setData,
    loading,
    error,
    setError,
    ready,
    letterhead,
    markSaved,
    getIsDirty,
    discard,
  } = usePaintSettingsData(onDirtyChange);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data) return false;
    if (readOnly) return true;

    setSaving(true);
    setMessage(null);
    setError(null);

    const errOrg = await patchOrgSettings(user.id, {
      tracker_email_schedule: data.tracker_email_schedule,
      notification_primary_email: data.notification_primary_email.trim(),
      notification_primary_name: data.notification_primary_name.trim(),
    });
    setSaving(false);
    if (errOrg) {
      setError(errOrg);
      return false;
    }
    markSaved();
    setMessage("Schedule settings saved.");
    return true;
  }, [data, markSaved, readOnly, setError, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({ save: persist, discard, getIsDirty });
  }, [ready, onBindActions, persist, discard, getIsDirty]);

  if (loading) return <p className="muted">Loading schedule settings…</p>;
  if (!data || !user?.id) return null;

  const notifyEmailWarning = emailAddressWarning(data.notification_primary_email);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  return (
    <form className="stack paint-email-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>Recipients</h2>
        <label>
          Notification primary name
          <input
            value={data.notification_primary_name}
            disabled={readOnly}
            onChange={(e) =>
              setData((d) => (d ? { ...d, notification_primary_name: e.target.value } : d))
            }
            placeholder="John Ortega"
          />
        </label>
        <label>
          Notification primary email (scheduled digests To)
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={data.notification_primary_email}
            disabled={readOnly}
            onChange={(e) =>
              setData((d) => (d ? { ...d, notification_primary_email: e.target.value } : d))
            }
            placeholder="you@company.com"
          />
        </label>
        {!data.notification_primary_email.trim() && (
          <p className="muted small" style={{ color: "var(--danger, #b71c1c)" }}>
            Scheduled digests will not send until this email is set.
          </p>
        )}
        {notifyEmailWarning ? (
          <div className="banner banner-warn" role="status">
            {notifyEmailWarning} You can still save — fix it if this address should receive mail.
          </div>
        ) : null}
        {!(data.google_urls.field_request_order ?? "").trim() ? (
          <p className="muted small">
            Field Request Order URL is empty (Settings → Mailing Settings). Digests and paint tracker
            notices use the same Apps Script as Field Tools (<code>sendJobFlowEmail</code>).
          </p>
        ) : null}
      </section>

      <WeeklyDigestSection
        data={data}
        letterhead={letterhead}
        brandingCompanyName={letterhead.company_name}
      />

      <FollowUpRemindersSection
        data={data}
        letterhead={letterhead}
        brandingCompanyName={letterhead.company_name}
      />

      <BillingDueDigestSection
        data={data}
        letterhead={letterhead}
        brandingCompanyName={letterhead.company_name}
      />

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
        <ScheduledEmailSection
          schedule={data.tracker_email_schedule}
          onChange={(tracker_email_schedule) =>
            setData((d) => (d ? { ...d, tracker_email_schedule } : d))
          }
        />
      </fieldset>

      {!readOnly && (
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save schedule settings"}
        </button>
      )}
    </form>
  );
}
