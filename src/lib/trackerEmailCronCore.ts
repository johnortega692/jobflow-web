import { normalizeLetterheadSettings } from "../types/letterheadSettings";
import { loadAllProjectsAdmin } from "./loadAllProjectsAdmin";
import { loadEffectiveUserSettingsAdmin, loadOrgSettingsBlobAdmin } from "./orgSettingsAdmin";
import { loadPaintUserSettingsFromRaw } from "./paintUserSettingsLoad";
import { profileFromSettings } from "./userProfile";
import { sendFollowUpReminderViaGasDirect, followUpReminderHasContent } from "./trackerFollowUpReminders";
import type { TrackerEmailCronSlot } from "./trackerEmailSchedule";
import { sendWeeklyTrackerDigestViaGasDirect } from "./trackerWeeklyDigest";
import { listTrackerCronTargets, ORG_TRACKER_CRON_TARGET } from "./userSettingsAdmin";

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

function cronTargetLabel(targetId: string): string {
  return targetId === ORG_TRACKER_CRON_TARGET ? "org" : targetId;
}

async function loadCronSettings(targetId: string): Promise<Record<string, unknown>> {
  if (targetId === ORG_TRACKER_CRON_TARGET) {
    return loadOrgSettingsBlobAdmin();
  }
  return loadEffectiveUserSettingsAdmin(targetId);
}

function resolvePrimaryRecipient(
  raw: Record<string, unknown>,
  paint: ReturnType<typeof loadPaintUserSettingsFromRaw>,
  isOrgRun: boolean,
): { email: string; name: string } {
  if (isOrgRun) {
    const email = paint.notification_primary_email.trim();
    const name = paint.notification_primary_name.trim();
    if (email) return { email, name: name || "PM" };
  }
  const profile = profileFromSettings(normalizeLetterheadSettings(raw));
  return {
    email: profile.email.trim(),
    name: profile.name.trim() || "PM",
  };
}

export async function runTrackerEmailCron(slot: TrackerEmailCronSlot): Promise<CronRunResult> {
  const result: CronRunResult = { slot, usersProcessed: 0, sent: [], skipped: [], errors: [] };

  const targetIds = await listTrackerCronTargets();
  if (!targetIds.length) return result;

  const { projects, error: projectsError } = await loadAllProjectsAdmin();
  if (projectsError) throw new Error(projectsError);

  for (const targetId of targetIds) {
    result.usersProcessed += 1;
    const label = cronTargetLabel(targetId);
    const isOrgRun = targetId === ORG_TRACKER_CRON_TARGET;

    try {
      const raw = await loadCronSettings(targetId);
      const paint = loadPaintUserSettingsFromRaw(raw);
      const schedule = paint.tracker_email_schedule;
      if (!schedule.enabled) {
        result.skipped.push(`${label}: schedule disabled`);
        continue;
      }

      const gasUrl = (paint.google_urls.paint_tracker ?? "").trim();
      const { email: primaryEmail, name: primaryName } = resolvePrimaryRecipient(raw, paint, isOrgRun);
      if (!gasUrl) {
        result.skipped.push(`${label}: missing Dashboard Web App URL`);
        continue;
      }
      if (!primaryEmail) {
        result.skipped.push(
          `${label}: missing ${isOrgRun ? "notification primary email in Paint & email settings" : "profile email"}`,
        );
        continue;
      }

      applyTimezone(schedule.timezone);
      const letterhead = normalizeLetterheadSettings(raw);
      const companyName = letterhead.company_name.trim() || "JobFlow";
      const sendBase = {
        projects,
        primaryEmail,
        primaryName,
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
            result.sent.push(`${label}: paint follow-up`);
          } else {
            result.skipped.push(`${label}: paint follow-up (nothing due)`);
          }
        }
        if (schedule.daily.wallcovering_followup) {
          if (followUpReminderHasContent("wallcovering", projects)) {
            await sendFollowUpReminderViaGasDirect({ kind: "wallcovering", ...sendBase });
            result.sent.push(`${label}: wallcovering follow-up`);
          } else {
            result.skipped.push(`${label}: wallcovering follow-up (nothing due)`);
          }
        }
        if (schedule.daily.installs) {
          if (followUpReminderHasContent("installs", projects)) {
            await sendFollowUpReminderViaGasDirect({ kind: "installs", ...sendBase });
            result.sent.push(`${label}: installs reminder`);
          } else {
            result.skipped.push(`${label}: installs (nothing upcoming)`);
          }
        }
      } else if (slot === "daily" && !schedule.daily.enabled) {
        result.skipped.push(`${label}: daily schedule disabled`);
      }

      if (slot === "weekly" && schedule.weekly.enabled) {
        if (schedule.weekly.combined_digest) {
          await sendWeeklyTrackerDigestViaGasDirect({ kind: "combined", ...sendBase });
          result.sent.push(`${label}: combined weekly digest`);
        }
        if (schedule.weekly.wallcovering_digest) {
          await sendWeeklyTrackerDigestViaGasDirect({ kind: "wallcovering", ...sendBase });
          result.sent.push(`${label}: wallcovering weekly digest`);
        }
      } else if (slot === "weekly" && !schedule.weekly.enabled) {
        result.skipped.push(`${label}: weekly schedule disabled`);
      }
    } catch (e) {
      result.errors.push({
        userId: label,
        message: e instanceof Error ? e.message : "Unknown cron error",
      });
    }
  }

  return result;
}
