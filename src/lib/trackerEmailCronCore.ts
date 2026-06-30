import { normalizeLetterheadSettings } from "../types/letterheadSettings";
import { loadAllProjectsAdmin } from "./loadAllProjectsAdmin";
import { loadEffectiveUserSettingsAdmin } from "./orgSettingsAdmin";
import { loadPaintUserSettingsFromRaw } from "./paintUserSettingsLoad";
import { profileFromSettings } from "./userProfile";
import { sendFollowUpReminderViaGasDirect, followUpReminderHasContent } from "./trackerFollowUpReminders";
import type { TrackerEmailCronSlot } from "./trackerEmailSchedule";
import { sendWeeklyTrackerDigestViaGasDirect } from "./trackerWeeklyDigest";
import { listUserIdsWithTrackerScheduleEnabled } from "./userSettingsAdmin";

export type CronRunResult = {
  slot: TrackerEmailCronSlot;
  usersProcessed: number;
  sent: string[];
  skipped: string[];
  errors: { userId: string; message: string }[];
};

function applyTimezone(timezone: string): void {
  const tz = timezone.trim() || "America/Los_Angeles";
  try {
    process.env.TZ = tz;
  } catch {
    /* ignore */
  }
}

async function resolveCronUserIds(): Promise<string[]> {
  const forced = (process.env.TRACKER_CRON_USER_ID ?? "").trim();
  if (forced) return [forced];
  return listUserIdsWithTrackerScheduleEnabled();
}

export async function runTrackerEmailCron(slot: TrackerEmailCronSlot): Promise<CronRunResult> {
  const result: CronRunResult = { slot, usersProcessed: 0, sent: [], skipped: [], errors: [] };

  const userIds = await resolveCronUserIds();
  if (!userIds.length) return result;

  const { projects, error: projectsError } = await loadAllProjectsAdmin();
  if (projectsError) throw new Error(projectsError);

  for (const userId of userIds) {
    result.usersProcessed += 1;
    try {
      const raw = await loadEffectiveUserSettingsAdmin(userId);
      const paint = loadPaintUserSettingsFromRaw(raw);
      const schedule = paint.tracker_email_schedule;
      if (!schedule.enabled) {
        result.skipped.push(`${userId}: schedule disabled`);
        continue;
      }

      const gasUrl = (paint.google_urls.paint_tracker ?? "").trim();
      const profile = profileFromSettings(normalizeLetterheadSettings(raw));
      const primaryEmail = profile.email.trim();
      if (!gasUrl) {
        result.skipped.push(`${userId}: missing Dashboard Web App URL`);
        continue;
      }
      if (!primaryEmail) {
        result.skipped.push(`${userId}: missing profile email`);
        continue;
      }

      applyTimezone(schedule.timezone);
      const letterhead = normalizeLetterheadSettings(raw);
      const companyName = letterhead.company_name.trim() || "JobFlow";
      const sendBase = {
        projects,
        primaryEmail,
        primaryName: profile.name.trim() || "PM",
        companyName,
        companyAddress: letterhead.company_address,
        fromName: `${companyName} Dashboard`.trim(),
        gasUrl,
        logoUrl: letterhead.logo_url,
      };

      if (slot === "daily" && schedule.daily.enabled) {
        if (schedule.daily.paint_followup) {
          if (followUpReminderHasContent("paint", projects)) {
            await sendFollowUpReminderViaGasDirect({ kind: "paint", ...sendBase });
            result.sent.push(`${userId}: paint follow-up`);
          } else {
            result.skipped.push(`${userId}: paint follow-up (nothing due)`);
          }
        }
        if (schedule.daily.wallcovering_followup) {
          if (followUpReminderHasContent("wallcovering", projects)) {
            await sendFollowUpReminderViaGasDirect({ kind: "wallcovering", ...sendBase });
            result.sent.push(`${userId}: wallcovering follow-up`);
          } else {
            result.skipped.push(`${userId}: wallcovering follow-up (nothing due)`);
          }
        }
        if (schedule.daily.installs) {
          if (followUpReminderHasContent("installs", projects)) {
            await sendFollowUpReminderViaGasDirect({ kind: "installs", ...sendBase });
            result.sent.push(`${userId}: installs reminder`);
          } else {
            result.skipped.push(`${userId}: installs (nothing upcoming)`);
          }
        }
      } else if (slot === "daily" && !schedule.daily.enabled) {
        result.skipped.push(`${userId}: daily schedule disabled`);
      }

      if (slot === "weekly" && schedule.weekly.enabled) {
        if (schedule.weekly.combined_digest) {
          await sendWeeklyTrackerDigestViaGasDirect({ kind: "combined", ...sendBase });
          result.sent.push(`${userId}: combined weekly digest`);
        }
        if (schedule.weekly.wallcovering_digest) {
          await sendWeeklyTrackerDigestViaGasDirect({ kind: "wallcovering", ...sendBase });
          result.sent.push(`${userId}: wallcovering weekly digest`);
        }
      } else if (slot === "weekly" && !schedule.weekly.enabled) {
        result.skipped.push(`${userId}: weekly schedule disabled`);
      }
    } catch (e) {
      result.errors.push({
        userId,
        message: e instanceof Error ? e.message : "Unknown cron error",
      });
    }
  }

  return result;
}
