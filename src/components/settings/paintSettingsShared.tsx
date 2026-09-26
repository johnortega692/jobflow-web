import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { loadPaintUserSettings, type PaintUserSettings } from "../../lib/paintUserSettings";
import { mergeProfileIntoEmailSignature } from "../../lib/paintProfileDefaults";
import { profileFromSettings } from "../../lib/userProfile";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import {
  loadProjectsForFollowUpReminders,
  sendFollowUpReminder,
  type FollowUpReminderKind,
} from "../../lib/trackerFollowUpReminders";
import {
  loadProjectsForWeeklyDigest,
  sendWeeklyTrackerDigest,
  type WeeklyDigestKind,
} from "../../lib/trackerWeeklyDigest";
import { sendSiteReadyDigest } from "../../lib/startupSiteReadyDigest";
import {
  BILLING_DUE_REMINDER_DAYS_BEFORE,
  loadProjectsForBillingDueDigest,
  sendBillingDueDigest,
} from "../../lib/billingDueDigest";
import {
  createBrowserScheduleEmailPoster,
  resolveScheduleEmailUrls,
} from "../../lib/scheduleEmailSend";
import { JOBFLOW_SCHEDULE_FROM_NAME } from "../../lib/jobflowScheduleFrom";
import type { LetterheadSettings } from "../../types/letterheadSettings";
import { recordTrackerEmailCronStatus } from "../../lib/orgSettings";
import {
  buildTrackerEmailCronStatus,
  formatTrackerEmailCronStatusTime,
  trackerEmailCronStatusLabel,
  trackerEmailCronStatusTone,
  type TrackerEmailCronStatus,
} from "../../lib/trackerEmailCronStatus";
import {
  DEFAULT_TRACKER_EMAIL_SCHEDULE,
  WEEKDAY_LABELS,
  trackerCronUtcHint,
  weekdayLabel,
  type TrackerEmailSchedule,
} from "../../lib/trackerEmailSchedule";

function scheduleSendChannel(data: PaintUserSettings) {
  const urls = resolveScheduleEmailUrls(data.google_urls);
  const gasPost = createBrowserScheduleEmailPoster(urls);
  const gasUrl = urls.fieldOrderUrl;
  return { urls, gasPost, gasUrl };
}

export function TrackerEmailCronStatusBanner({
  status,
  timezone,
}: {
  status: TrackerEmailCronStatus | null;
  timezone: string;
}) {
  if (!status) {
    return (
      <div className="banner banner-info">
        Automatic send: no run recorded yet. After the next scheduled send (~15:00 UTC), Sent or Error
        will show here with the date and time.
      </div>
    );
  }
  const source = status.source === "automatic" ? "Automatic" : "Send now";
  return (
    <div className={`banner ${trackerEmailCronStatusTone(status)}`}>
      <strong>{trackerEmailCronStatusLabel(status)}</strong>
      {` · ${source} · ${formatTrackerEmailCronStatusTime(status.at, timezone)}`}
      <div>{status.message}</div>
    </div>
  );
}

export function usePaintSettingsData(onDirtyChange?: (dirty: boolean) => void) {
  const { user } = useAuth();
  const { settings: letterhead } = useLetterhead();
  const [data, setData] = useState<PaintUserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ready = !loading && data !== null && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(data, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    const profile = profileFromSettings(letterhead);
    void loadPaintUserSettings(user.id)
      .then((loaded) =>
        setData({
          ...loaded,
          signature: mergeProfileIntoEmailSignature(loaded.signature, profile),
        }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load settings"))
      .finally(() => setLoading(false));
  }, [user?.id, letterhead.signer_name, letterhead.signer_title, letterhead.signer_phone, letterhead.signer_email]);

  const discard = useCallback(() => {
    const snapshot = readBaseline();
    if (snapshot) setData(snapshot);
  }, [readBaseline]);

  return {
    user,
    letterhead,
    data,
    setData,
    loading,
    error,
    setError,
    ready,
    markSaved,
    getIsDirty,
    discard,
  };
}

export function WeeklyDigestSection({
  data,
  letterhead,
  brandingCompanyName,
  onStatus,
}: {
  data: PaintUserSettings;
  letterhead: LetterheadSettings;
  brandingCompanyName: string;
  onStatus?: (status: TrackerEmailCronStatus) => void;
}) {
  const { user } = useAuth();
  const [digestSending, setDigestSending] = useState<"combined" | "wallcovering" | "site_ready" | null>(
    null,
  );
  const [digestMessage, setDigestMessage] = useState<string | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);

  const { gasPost, gasUrl } = scheduleSendChannel(data);
  const profile = profileFromSettings(letterhead);
  const primaryEmail = profile.email.trim();
  const companyName = brandingCompanyName.trim() || letterhead.company_name.trim() || "JobFlow";

  async function sendDigest(kind: WeeklyDigestKind | "site_ready") {
    setDigestSending(kind);
    setDigestMessage(null);
    setDigestError(null);

    if (!primaryEmail) {
      setDigestError("Set email on your Profile (Settings → Profile & letterhead).");
      setDigestSending(null);
      return;
    }

    async function remember(result: "sent" | "skipped" | "error", message: string) {
      const status = buildTrackerEmailCronStatus({
        source: "send_now",
        ok: result !== "error",
        sent: result === "sent" ? [message] : [],
        skipped: result === "skipped" ? [message] : [],
        errors: result === "error" ? [{ message }] : [],
        message,
      });
      onStatus?.(status);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
    }

    try {
      const { projects, error } = await loadProjectsForWeeklyDigest();
      if (error) throw new Error(error);
      if (kind === "site_ready") {
        const result = await sendSiteReadyDigest({
          projects,
          primaryEmail,
          primaryName: profile.name.trim() || "PM",
          companyName,
          companyAddress: letterhead.company_address,
          fromName: JOBFLOW_SCHEDULE_FROM_NAME,
          gasUrl,
          logoUrl: letterhead.logo_url,
          gasPost,
        });
        const msg = result.sent
          ? `Site-ready digest sent (${result.count} job${result.count === 1 ? "" : "s"}).`
          : "Site-ready digest: nothing due right now.";
        setDigestMessage(msg);
        await remember(result.sent ? "sent" : "skipped", msg);
      } else {
        await sendWeeklyTrackerDigest({
          kind,
          projects,
          primaryEmail,
          primaryName: profile.name.trim() || "PM",
          companyName,
          companyAddress: letterhead.company_address,
          fromName: JOBFLOW_SCHEDULE_FROM_NAME,
          gasUrl,
          logoUrl: letterhead.logo_url,
          gasPost,
        });
        const msg =
          kind === "combined"
            ? "Combined weekly submittal digest sent."
            : "Wallcovering weekly digest sent.";
        setDigestMessage(msg);
        await remember("sent", msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send digest.";
      setDigestError(msg);
      await remember("error", msg);
    } finally {
      setDigestSending(null);
    }
  }

  return (
    <section className="stack">
      <h2>Weekly digests</h2>
      {(digestError || digestMessage) && (
        <div className={`banner ${digestError ? "banner-error" : "banner-ok"}`}>
          {digestError ?? digestMessage}
        </div>
      )}
      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={digestSending !== null}
          onClick={() => void sendDigest("combined")}
        >
          {digestSending === "combined" ? "Sending…" : "Send combined paint + WC digest"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={digestSending !== null}
          onClick={() => void sendDigest("wallcovering")}
        >
          {digestSending === "wallcovering" ? "Sending…" : "Send wallcovering digest only"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={digestSending !== null}
          onClick={() => void sendDigest("site_ready")}
        >
          {digestSending === "site_ready" ? "Sending…" : "Send Monday site-ready digest now"}
        </button>
      </div>
    </section>
  );
}

export function BillingDueDigestSection({
  data,
  letterhead,
  brandingCompanyName,
  onStatus,
}: {
  data: PaintUserSettings;
  letterhead: LetterheadSettings;
  brandingCompanyName: string;
  onStatus?: (status: TrackerEmailCronStatus) => void;
}) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { gasPost, gasUrl } = scheduleSendChannel(data);
  const companyName = brandingCompanyName.trim() || letterhead.company_name.trim() || "JobFlow";

  async function sendNow() {
    setSending(true);
    setMessage(null);
    setError(null);

    try {
      const { projects, error: loadError } = await loadProjectsForBillingDueDigest();
      if (loadError) throw new Error(loadError);
      const result = await sendBillingDueDigest({
        projects,
        companyName,
        companyAddress: letterhead.company_address,
        fromName: JOBFLOW_SCHEDULE_FROM_NAME,
        gasUrl,
        logoUrl: letterhead.logo_url,
        gasPost,
      });
      if (!result.sent) {
        const msg = `Billing due: no jobs are ${BILLING_DUE_REMINDER_DAYS_BEFORE} days from their Billing Due day today.`;
        setMessage(msg);
        const status = buildTrackerEmailCronStatus({
          source: "send_now",
          ok: true,
          skipped: [msg],
          message: msg,
        });
        onStatus?.(status);
        if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
      } else {
        const skipped =
          result.skippedNoPm > 0
            ? ` (${result.skippedNoPm} job${result.skippedNoPm === 1 ? "" : "s"} skipped — no ICBI PM email)`
            : "";
        const msg = `Billing due reminder sent to ${result.pmCount} ICBI PM${result.pmCount === 1 ? "" : "s"} (${result.count} job${result.count === 1 ? "" : "s"})${skipped}.`;
        setMessage(msg);
        const status = buildTrackerEmailCronStatus({
          source: "send_now",
          ok: true,
          sent: [msg],
          message: msg,
        });
        onStatus?.(status);
        if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send billing due email.";
      setError(msg);
      const status = buildTrackerEmailCronStatus({
        source: "send_now",
        ok: false,
        errors: [{ message: msg }],
        message: msg,
      });
      onStatus?.(status);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="stack">
      <h2>Billing due</h2>
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}
      <div className="row-gap wrap">
        <button type="button" className="btn btn-secondary" disabled={sending} onClick={() => void sendNow()}>
          {sending ? "Sending…" : `Send ${BILLING_DUE_REMINDER_DAYS_BEFORE}-day billing reminders now`}
        </button>
      </div>
    </section>
  );
}

export function FollowUpRemindersSection({
  data,
  letterhead,
  brandingCompanyName,
  onStatus,
}: {
  data: PaintUserSettings;
  letterhead: LetterheadSettings;
  brandingCompanyName: string;
  onStatus?: (status: TrackerEmailCronStatus) => void;
}) {
  const { user } = useAuth();
  const [sending, setSending] = useState<FollowUpReminderKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const { gasPost, gasUrl } = scheduleSendChannel(data);
  const profile = profileFromSettings(letterhead);
  const primaryEmail = profile.email.trim();
  const companyName = brandingCompanyName.trim() || letterhead.company_name.trim() || "JobFlow";

  async function sendReminder(kind: FollowUpReminderKind) {
    setSending(kind);
    setStatus(null);
    setStatusError(null);

    if (!primaryEmail) {
      setStatusError("Set email on your Profile (Settings → Profile & letterhead).");
      setSending(null);
      return;
    }

    try {
      const { projects, error } = await loadProjectsForFollowUpReminders();
      if (error) throw new Error(error);
      await sendFollowUpReminder({
        kind,
        projects,
        primaryEmail,
        primaryName: profile.name.trim() || "PM",
        companyName,
        companyAddress: letterhead.company_address,
        fromName: JOBFLOW_SCHEDULE_FROM_NAME,
        gasUrl,
        logoUrl: letterhead.logo_url,
        gasPost,
      });
      const labels: Record<FollowUpReminderKind, string> = {
        paint: "Paint follow-up reminder",
        wallcovering: "Wallcovering follow-up reminder",
        installs: "Upcoming installations reminder",
      };
      const msg = `${labels[kind]} sent.`;
      setStatus(msg);
      const recorded = buildTrackerEmailCronStatus({
        source: "send_now",
        ok: true,
        sent: [msg],
        message: msg,
      });
      onStatus?.(recorded);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, recorded);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send reminder.";
      setStatusError(msg);
      const recorded = buildTrackerEmailCronStatus({
        source: "send_now",
        ok: false,
        errors: [{ message: msg }],
        message: msg,
      });
      onStatus?.(recorded);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, recorded);
    } finally {
      setSending(null);
    }
  }

  return (
    <section className="stack">
      <h2>Follow-up &amp; install reminders</h2>
      {(statusError || status) && (
        <div className={`banner ${statusError ? "banner-error" : "banner-ok"}`}>
          {statusError ?? status}
        </div>
      )}
      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("paint")}
        >
          {sending === "paint" ? "Sending…" : "Send paint follow-up reminder"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("wallcovering")}
        >
          {sending === "wallcovering" ? "Sending…" : "Send wallcovering follow-up reminder"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("installs")}
        >
          {sending === "installs" ? "Sending…" : "Send upcoming install reminder"}
        </button>
      </div>
    </section>
  );
}

export function ScheduledEmailSection({
  schedule,
  onChange,
}: {
  schedule: TrackerEmailSchedule;
  onChange: (next: TrackerEmailSchedule) => void;
}) {
  function patchSchedule(patch: Partial<TrackerEmailSchedule>) {
    onChange({ ...schedule, ...patch });
  }

  function patchDaily(patch: Partial<TrackerEmailSchedule["daily"]>) {
    onChange({ ...schedule, daily: { ...schedule.daily, ...patch } });
  }

  function patchWeekly(patch: Partial<TrackerEmailSchedule["weekly"]>) {
    onChange({ ...schedule, weekly: { ...schedule.weekly, ...patch } });
  }

  return (
    <section className="stack">
      <h2>Scheduled emails (automatic)</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => patchSchedule({ enabled: e.target.checked })}
        />
        Enable automatic tracker emails (company-wide)
      </label>
      <label>
        Timezone for &quot;due today&quot; follow-ups
        <input
          value={schedule.timezone}
          onChange={(e) => patchSchedule({ timezone: e.target.value })}
          placeholder={DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone}
        />
      </label>

      <div className="stack">
        <h3 className="paint-col-head">Daily follow-ups</h3>
        <p className="muted small">{trackerCronUtcHint("daily")}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.daily.enabled}
            onChange={(e) => patchDaily({ enabled: e.target.checked })}
          />
          Send daily follow-up / install reminders
        </label>
        <div className="row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.paint_followup}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ paint_followup: e.target.checked })}
            />
            Paint follow-ups
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.wallcovering_followup}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ wallcovering_followup: e.target.checked })}
            />
            Wallcovering follow-ups
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.installs}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ installs: e.target.checked })}
            />
            Upcoming installs (14 days)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.billing_due}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ billing_due: e.target.checked })}
            />
            Billing due (ICBI PM, 4 days before)
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Billing due runs daily and emails each job&apos;s ICBI PM exactly 4 days before that job&apos;s Billing
          Due day.
        </p>
      </div>

      <div className="stack">
        <h3 className="paint-col-head">Weekly digest</h3>
        <p className="muted small">
          Automatic send is ~8:00 AM Pacific. Pick a send day to test without waiting for Friday or Monday.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.weekly.enabled}
            onChange={(e) => patchWeekly({ enabled: e.target.checked })}
          />
          Send weekly submittal digests
        </label>
        <div className="row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.weekly.combined_digest}
              disabled={!schedule.weekly.enabled}
              onChange={(e) => patchWeekly({ combined_digest: e.target.checked })}
            />
            Combined paint + wallcovering digest
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.weekly.wallcovering_digest}
              disabled={!schedule.weekly.enabled}
              onChange={(e) => patchWeekly({ wallcovering_digest: e.target.checked })}
            />
            Wallcovering digest only
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.weekly.startup_site_ready}
              disabled={!schedule.weekly.enabled}
              onChange={(e) => patchWeekly({ startup_site_ready: e.target.checked })}
            />
            Site-ready + Needs attention (contract / COI / billing)
          </label>
        </div>
        <label>
          Send paint / wallcovering digest on
          <select
            className="paint-field-select"
            value={schedule.weekly.digest_weekday}
            disabled={!schedule.weekly.enabled}
            onChange={(e) => patchWeekly({ digest_weekday: Number(e.target.value) })}
          >
            {WEEKDAY_LABELS.map((label, value) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          {trackerCronUtcHint("digest", schedule.weekly.digest_weekday)}
        </p>
        <label>
          Send site-ready digest on
          <select
            className="paint-field-select"
            value={schedule.weekly.site_ready_weekday}
            disabled={!schedule.weekly.enabled}
            onChange={(e) => patchWeekly({ site_ready_weekday: Number(e.target.value) })}
          >
            {WEEKDAY_LABELS.map((label, value) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          {trackerCronUtcHint("site_ready", schedule.weekly.site_ready_weekday)}. Defaults are Friday
          digest and Monday site-ready.
          {schedule.weekly.digest_weekday === schedule.weekly.site_ready_weekday
            ? ` Both will send on ${weekdayLabel(schedule.weekly.digest_weekday)}.`
            : ""}
        </p>
      </div>
    </section>
  );
}
