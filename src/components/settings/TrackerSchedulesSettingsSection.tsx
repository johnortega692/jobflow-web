import { FormEvent, useCallback, useEffect, useState } from "react";
import { patchOrgSettings } from "../../lib/budgetLibrary";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import {
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
        <p className="muted small">
          Manual sends and scheduled emails go <strong>To</strong> your Profile email (or notification primary
          email for automatic cron). <strong>CC</strong> uses ICBI super and foreman from each job&apos;s setup.
          Paint tracker approval/revision notifications use <strong>Job setup → GC Info</strong> for the GC
          Super line. Brush-out vendor emails CC the <strong>GC super</strong>. Transmittal/attic emails still
          CC ICBI staff.
        </p>
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
