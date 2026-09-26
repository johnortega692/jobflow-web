import { FormEvent, useCallback, useEffect, useState } from "react";
import { EmailAddressWarning } from "../EmailAddressWarning";
import { patchOrgSettings } from "../../lib/budgetLibrary";
import { loadOrgSettingsBlob, recordTrackerEmailCronStatus } from "../../lib/orgSettings";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import { usePaintSettingsData } from "./paintSettingsShared";
import {
  normalizeTrackerEmailCronStatus,
  buildTrackerEmailCronStatus,
  formatTrackerEmailCronStatusTime,
  type TrackerEmailCronStatus,
} from "../../lib/trackerEmailCronStatus";
import { useAuth } from "../../contexts/AuthContext";
import { JOBFLOW_SCHEDULE_FROM_NAME } from "../../lib/jobflowScheduleFrom";
import {
  createBrowserScheduleEmailPoster,
  resolveScheduleEmailUrls,
} from "../../lib/scheduleEmailSend";
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
  WEEKDAY_LABELS,
  formatSendHourLabel,
  zonedCalendarDate,
  type TrackerEmailSchedule,
} from "../../lib/trackerEmailSchedule";
import type { PaintUserSettings } from "../../lib/paintUserSettings";

const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "Pacific/Honolulu",
];

type SendKey =
  | "paint"
  | "wallcovering"
  | "installs"
  | "billing"
  | "combined"
  | "wc_digest"
  | "site_ready";

function timezoneShort(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}

function cronSentChips(sent: string[]): string[] {
  const rules: { test: RegExp; label: string }[] = [
    { test: /site-ready/i, label: "Monday site-ready digest" },
    { test: /combined/i, label: "Combined weekly digest" },
    { test: /wallcovering weekly|wallcovering digest/i, label: "Wallcovering weekly digest" },
    { test: /paint follow-up/i, label: "Paint follow-up" },
    { test: /wallcovering follow-up/i, label: "Wallcovering follow-up" },
    { test: /installs/i, label: "Upcoming installs" },
    { test: /billing due/i, label: "Billing due" },
  ];
  const chips: string[] = [];
  for (const row of sent) {
    const hit = rules.find((rule) => rule.test.test(row));
    const label = hit?.label ?? row.replace(/^[^:]+:\s*/, "");
    if (label && !chips.includes(label)) chips.push(label);
  }
  return chips;
}

function ScheduleToggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`sched-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="sched-toggle-knob" />
    </button>
  );
}

function SendNowButton({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="btn btn-secondary sched-send-btn" disabled={disabled || busy} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4 20-7z" />
      </svg>
      {busy ? "Sending…" : "Send now"}
    </button>
  );
}

function WeekdaySelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <select
      className="sched-day-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Send day"
    >
      {WEEKDAY_LABELS.map((label, day) => (
        <option key={label} value={day}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function TrackerSchedulesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { isAdmin } = useAuth();
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
  const [cronStatus, setCronStatus] = useState<TrackerEmailCronStatus | null>(null);
  const [sending, setSending] = useState<SendKey | null>(null);
  const [sendNote, setSendNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadOrgSettingsBlob().then((blob) => {
      setCronStatus(normalizeTrackerEmailCronStatus(blob.tracker_email_cron_status));
    });
  }, []);

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
    setMessage("All changes saved");
    return true;
  }, [data, markSaved, readOnly, setError, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({ save: persist, discard, getIsDirty });
  }, [ready, onBindActions, persist, discard, getIsDirty]);

  if (loading) return <p className="muted">Loading schedule settings…</p>;
  if (!data || !user?.id) return null;

  const schedule = data.tracker_email_schedule;
  const tzShort = timezoneShort(schedule.timezone);
  const hourLabel = formatSendHourLabel(schedule.send_hour);
  const dirty = getIsDirty();
  const chips = cronStatus?.sent?.length ? cronSentChips(cronStatus.sent) : [];

  function patchSchedule(patch: Partial<TrackerEmailSchedule>) {
    setData((d) => (d ? { ...d, tracker_email_schedule: { ...d.tracker_email_schedule, ...patch } } : d));
  }
  function patchDaily(patch: Partial<TrackerEmailSchedule["daily"]>) {
    setData((d) =>
      d
        ? { ...d, tracker_email_schedule: { ...d.tracker_email_schedule, daily: { ...d.tracker_email_schedule.daily, ...patch } } }
        : d,
    );
  }
  function patchWeekly(patch: Partial<TrackerEmailSchedule["weekly"]>) {
    setData((d) =>
      d
        ? {
            ...d,
            tracker_email_schedule: {
              ...d.tracker_email_schedule,
              weekly: { ...d.tracker_email_schedule.weekly, ...patch },
            },
          }
        : d,
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function runTestSend(key: SendKey, work: (ctx: ReturnType<typeof testSendContext>) => Promise<string>) {
    setSending(key);
    setSendNote(null);
    try {
      if (!data) throw new Error("Schedule settings are still loading.");
      const ctx = testSendContext(data, letterhead.company_name, letterhead.company_address, letterhead.logo_url);
      if (!ctx.primaryEmail) {
        throw new Error("Set a primary recipient email above before sending a test copy.");
      }
      const text = await work(ctx);
      setSendNote({ ok: true, text });
      const status = buildTrackerEmailCronStatus({ source: "send_now", ok: true, sent: [text], message: text });
      setCronStatus(status);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not send.";
      setSendNote({ ok: false, text });
      const status = buildTrackerEmailCronStatus({
        source: "send_now",
        ok: false,
        errors: [{ message: text }],
        message: text,
      });
      setCronStatus(status);
      if (user?.id) await recordTrackerEmailCronStatus(user.id, status);
    } finally {
      setSending(null);
    }
  }

  return (
    <form className="stack sched-page" onSubmit={(e) => void onSave(e)}>
      <div className="sched-title-row">
        <h2>Schedules</h2>
        {isAdmin ? <span className="sched-admin-badge">ADMIN</span> : null}
      </div>

      {readOnly && <SharedSettingsNotice />}
      {(error || sendNote) && (
        <div className={`banner ${error || (sendNote && !sendNote.ok) ? "banner-error" : "banner-ok"}`}>
          {error ?? sendNote?.text}
        </div>
      )}

      <div className={`sched-run-banner${cronStatus?.sent.length ? " is-ok" : cronStatus ? " is-muted" : ""}`}>
        {cronStatus ? (
          <>
            <p>
              <span className="sched-run-dot" aria-hidden />
              <strong>Last {cronStatus.source === "automatic" ? "automatic run" : "send now"}</strong>
              {" · "}
              {formatTrackerEmailCronStatusTime(cronStatus.at, schedule.timezone)}
            </p>
            {chips.length ? (
              <div className="sched-run-chips">
                {chips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
                {cronStatus.message}
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Automatic send: no run recorded yet.
          </p>
        )}
      </div>

      <section className="sched-card">
        <div className="sched-card-head">
          <ScheduleToggle
            label="Automatic tracker emails"
            checked={schedule.enabled}
            disabled={readOnly}
            onChange={(enabled) => patchSchedule({ enabled })}
          />
          <div className="sched-card-copy">
            <strong>Automatic tracker emails</strong>
            <p>Company-wide. When off, nothing sends on schedule. Send now still works for testing.</p>
          </div>
        </div>
        <div className="sched-grid">
          <label>
            Timezone
            <select
              value={TIMEZONES.includes(schedule.timezone) ? schedule.timezone : schedule.timezone}
              disabled={readOnly}
              onChange={(e) => patchSchedule({ timezone: e.target.value })}
            >
              {!TIMEZONES.includes(schedule.timezone) ? (
                <option value={schedule.timezone}>{schedule.timezone}</option>
              ) : null}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label>
            Send time (all automatic emails)
            <select
              value={schedule.send_hour}
              disabled={readOnly}
              onChange={(e) => patchSchedule({ send_hour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {formatSendHourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Primary recipient name
            <input
              value={data.notification_primary_name}
              disabled={readOnly}
              onChange={(e) => setData((d) => (d ? { ...d, notification_primary_name: e.target.value } : d))}
              placeholder="John Ortega"
            />
          </label>
          <label>
            Primary recipient email (digest To + test sends)
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={data.notification_primary_email}
              disabled={readOnly}
              onChange={(e) => setData((d) => (d ? { ...d, notification_primary_email: e.target.value } : d))}
              placeholder="you@company.com"
            />
            <EmailAddressWarning value={data.notification_primary_email} compact />
          </label>
        </div>
      </section>

      <section className="sched-card">
        <div className="sched-card-head">
          <ScheduleToggle
            label="Send daily follow-up / install reminders"
            checked={schedule.daily.enabled}
            disabled={readOnly}
            onChange={(enabled) => patchDaily({ enabled })}
          />
          <div className="sched-card-copy">
            <strong>Send daily follow-up / install reminders</strong>
            <p>
              every day · {hourLabel} {tzShort}
            </p>
          </div>
          <span className="sched-hint">Send now = test copy to you</span>
        </div>

        <ScheduleRow
          title="Paint follow-ups"
          detail="Items due today, emailed to each assignee"
          meta={`Daily · ${hourLabel}`}
          checked={schedule.daily.paint_followup}
          disabled={readOnly || !schedule.daily.enabled}
          busy={sending === "paint"}
          onToggle={(paint_followup) => patchDaily({ paint_followup })}
          onSend={() =>
            void runTestSend("paint", (ctx) => sendFollowUpKind("paint", ctx, schedule.timezone))
          }
        />
        <ScheduleRow
          title="Wallcovering follow-ups"
          detail="Items due today, emailed to each assignee"
          meta={`Daily · ${hourLabel}`}
          checked={schedule.daily.wallcovering_followup}
          disabled={readOnly || !schedule.daily.enabled}
          busy={sending === "wallcovering"}
          onToggle={(wallcovering_followup) => patchDaily({ wallcovering_followup })}
          onSend={() =>
            void runTestSend("wallcovering", (ctx) => sendFollowUpKind("wallcovering", ctx, schedule.timezone))
          }
        />
        <ScheduleRow
          title="Upcoming installs"
          detail="Installs scheduled in the next 14 days"
          meta={`Daily · ${hourLabel}`}
          checked={schedule.daily.installs}
          disabled={readOnly || !schedule.daily.enabled}
          busy={sending === "installs"}
          onToggle={(installs) => patchDaily({ installs })}
          onSend={() =>
            void runTestSend("installs", (ctx) => sendFollowUpKind("installs", ctx, schedule.timezone))
          }
        />
        <ScheduleRow
          title="Billing due"
          detail={`Each job's ICBI PM, ${BILLING_DUE_REMINDER_DAYS_BEFORE} days before Billing Due`}
          meta={`Daily · ${hourLabel}`}
          checked={schedule.daily.billing_due}
          disabled={readOnly || !schedule.daily.enabled}
          busy={sending === "billing"}
          onToggle={(billing_due) => patchDaily({ billing_due })}
          onSend={() => void runTestSend("billing", sendBillingTest)}
        />
      </section>

      <section className="sched-card">
        <div className="sched-card-head">
          <ScheduleToggle
            label="Send weekly submittal digests"
            checked={schedule.weekly.enabled}
            disabled={readOnly}
            onChange={(enabled) => patchWeekly({ enabled })}
          />
          <div className="sched-card-copy">
            <strong>Send weekly submittal digests</strong>
            <p>
              pick a day per digest · {hourLabel} {tzShort}
            </p>
          </div>
          <span className="sched-hint">Send now = test copy to you</span>
        </div>

        <ScheduleRow
          title="Combined paint + WC digest"
          detail="Open submittals across paint and wallcovering"
          checked={schedule.weekly.combined_digest}
          disabled={readOnly || !schedule.weekly.enabled}
          busy={sending === "combined"}
          weekday={schedule.weekly.digest_weekday}
          onWeekday={(digest_weekday) => patchWeekly({ digest_weekday })}
          onToggle={(combined_digest) => patchWeekly({ combined_digest })}
          onSend={() => void runTestSend("combined", (ctx) => sendDigestKind("combined", ctx))}
        />
        <ScheduleRow
          title="Wallcovering digest"
          detail="Wallcovering-only submittal summary"
          checked={schedule.weekly.wallcovering_digest}
          disabled={readOnly || !schedule.weekly.enabled}
          busy={sending === "wc_digest"}
          weekday={schedule.weekly.wallcovering_digest_weekday}
          onWeekday={(wallcovering_digest_weekday) => patchWeekly({ wallcovering_digest_weekday })}
          onToggle={(wallcovering_digest) => patchWeekly({ wallcovering_digest })}
          onSend={() => void runTestSend("wc_digest", (ctx) => sendDigestKind("wallcovering", ctx))}
        />
        <ScheduleRow
          title="Site-ready + Needs attention"
          detail="Contract, COI and billing gaps"
          checked={schedule.weekly.startup_site_ready}
          disabled={readOnly || !schedule.weekly.enabled}
          busy={sending === "site_ready"}
          weekday={schedule.weekly.site_ready_weekday}
          onWeekday={(site_ready_weekday) => patchWeekly({ site_ready_weekday })}
          onToggle={(startup_site_ready) => patchWeekly({ startup_site_ready })}
          onSend={() => void runTestSend("site_ready", sendSiteReadyTest)}
        />
      </section>

      {!readOnly && (
        <div className="sched-save-bar">
          <span className="muted">{dirty ? "Unsaved changes" : message || "All changes saved"}</span>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save schedule settings"}
          </button>
        </div>
      )}
    </form>
  );
}

function ScheduleRow({
  title,
  detail,
  meta,
  checked,
  disabled,
  busy,
  weekday,
  onWeekday,
  onToggle,
  onSend,
}: {
  title: string;
  detail: string;
  meta?: string;
  checked: boolean;
  disabled?: boolean;
  busy: boolean;
  weekday?: number;
  onWeekday?: (value: number) => void;
  onToggle: (next: boolean) => void;
  onSend: () => void;
}) {
  return (
    <div className="sched-row">
      <div className="sched-row-main">
        <ScheduleToggle label={title} checked={checked} disabled={disabled} onChange={onToggle} />
        <div>
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
      </div>
      {typeof weekday === "number" && onWeekday ? (
        <WeekdaySelect value={weekday} disabled={disabled} onChange={onWeekday} />
      ) : (
        <span className="sched-row-meta">{meta}</span>
      )}
      <SendNowButton busy={busy} onClick={onSend} />
    </div>
  );
}

function testSendContext(
  data: PaintUserSettings,
  companyName: string,
  companyAddress: string,
  logoUrl: string,
) {
  const urls = resolveScheduleEmailUrls(data.google_urls);
  return {
    gasPost: createBrowserScheduleEmailPoster(urls),
    gasUrl: urls.fieldOrderUrl,
    primaryEmail: data.notification_primary_email.trim(),
    primaryName: data.notification_primary_name.trim() || "PM",
    companyName: companyName.trim() || "JobFlow",
    companyAddress,
    logoUrl,
    timezone: data.tracker_email_schedule.timezone,
  };
}

async function sendFollowUpKind(
  kind: FollowUpReminderKind,
  ctx: ReturnType<typeof testSendContext>,
  timezone: string,
): Promise<string> {
  const { projects, error } = await loadProjectsForFollowUpReminders();
  if (error) throw new Error(error);
  await sendFollowUpReminder({
    kind,
    projects,
    primaryEmail: ctx.primaryEmail,
    primaryName: ctx.primaryName,
    companyName: ctx.companyName,
    companyAddress: ctx.companyAddress,
    fromName: JOBFLOW_SCHEDULE_FROM_NAME,
    gasUrl: ctx.gasUrl,
    logoUrl: ctx.logoUrl,
    gasPost: ctx.gasPost,
    timezone,
    today: zonedCalendarDate(new Date(), timezone),
  });
  const labels: Record<FollowUpReminderKind, string> = {
    paint: "Paint follow-up reminder sent.",
    wallcovering: "Wallcovering follow-up reminder sent.",
    installs: "Upcoming installations reminder sent.",
  };
  return labels[kind];
}

async function sendBillingTest(ctx: ReturnType<typeof testSendContext>): Promise<string> {
  const { projects, error } = await loadProjectsForBillingDueDigest();
  if (error) throw new Error(error);
  const result = await sendBillingDueDigest({
    projects,
    companyName: ctx.companyName,
    companyAddress: ctx.companyAddress,
    fromName: JOBFLOW_SCHEDULE_FROM_NAME,
    gasUrl: ctx.gasUrl,
    logoUrl: ctx.logoUrl,
    gasPost: ctx.gasPost,
    today: zonedCalendarDate(new Date(), ctx.timezone),
  });
  if (!result.sent) {
    throw new Error(
      `Billing due: no jobs are ${BILLING_DUE_REMINDER_DAYS_BEFORE} days from their Billing Due day today.`,
    );
  }
  return `Billing due reminder sent to ${result.pmCount} ICBI PM${result.pmCount === 1 ? "" : "s"} (${result.count} job${result.count === 1 ? "" : "s"}).`;
}

async function sendDigestKind(
  kind: WeeklyDigestKind,
  ctx: ReturnType<typeof testSendContext>,
): Promise<string> {
  const { projects, error } = await loadProjectsForWeeklyDigest();
  if (error) throw new Error(error);
  await sendWeeklyTrackerDigest({
    kind,
    projects,
    primaryEmail: ctx.primaryEmail,
    primaryName: ctx.primaryName,
    companyName: ctx.companyName,
    companyAddress: ctx.companyAddress,
    fromName: JOBFLOW_SCHEDULE_FROM_NAME,
    gasUrl: ctx.gasUrl,
    logoUrl: ctx.logoUrl,
    gasPost: ctx.gasPost,
  });
  return kind === "combined" ? "Combined weekly submittal digest sent." : "Wallcovering weekly digest sent.";
}

async function sendSiteReadyTest(ctx: ReturnType<typeof testSendContext>): Promise<string> {
  const { projects, error } = await loadProjectsForWeeklyDigest();
  if (error) throw new Error(error);
  const result = await sendSiteReadyDigest({
    projects,
    primaryEmail: ctx.primaryEmail,
    primaryName: ctx.primaryName,
    companyName: ctx.companyName,
    companyAddress: ctx.companyAddress,
    fromName: JOBFLOW_SCHEDULE_FROM_NAME,
    gasUrl: ctx.gasUrl,
    logoUrl: ctx.logoUrl,
    gasPost: ctx.gasPost,
  });
  if (!result.sent) throw new Error("Site-ready digest: nothing due right now.");
  return `Site-ready digest sent (${result.count} job${result.count === 1 ? "" : "s"}).`;
}
