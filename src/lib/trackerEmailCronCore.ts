import { normalizeLetterheadSettings } from "../types/letterheadSettings.js";
import { createCronEmailPoster, isResendConfigured } from "./cronEmailSend.js";
import { loadAllProjectsAdmin } from "./loadAllProjectsAdmin.js";
import { loadEffectiveUserSettingsAdmin, loadOrgSettingsBlobAdmin } from "./orgSettingsAdmin.js";
import { loadPaintUserSettingsFromRaw } from "./paintUserSettingsLoad.js";
import { profileFromSettings } from "./userProfile.js";
import {
  sendBillingDueDigest,
  billingDueDigestHasContent,
} from "./billingDueDigest.js";
import { sendFollowUpReminder, followUpReminderHasContent } from "./trackerFollowUpReminders.js";
import type { TrackerEmailCronSlot } from "./trackerEmailSchedule.js";
import { sendWeeklyTrackerDigest } from "./trackerWeeklyDigest.js";
import { sendSiteReadyDigest, siteReadyDigestHasContent } from "./startupSiteReadyDigest.js";
import { listTrackerCronTargets, ORG_TRACKER_CRON_TARGET } from "./userSettingsAdmin.js";

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
  if (!targetIds.length) {
    result.skipped.push("no cron targets (enable Scheduled emails master switch and Save)");
    return result;
  }

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

      const urls = {
        fieldOrderUrl:
          (paint.google_urls.field_request_order ?? "").trim() ||
          (process.env.GAS_SEND_EMAIL_URL ?? "").trim(),
        dashboardUrl: (paint.google_urls.paint_tracker ?? "").trim(),
      };
      const resendOk = isResendConfigured();
      const { email: primaryEmail, name: primaryName } = resolvePrimaryRecipient(raw, paint, isOrgRun);
      if (!urls.fieldOrderUrl && !urls.dashboardUrl && !resendOk) {
        result.skipped.push(
          `${label}: missing Field Request Order URL (and Dashboard Web App URL / Resend)`,
        );
        continue;
      }

      const dailyBillingOnly =
        slot === "daily" &&
        schedule.daily.enabled &&
        schedule.daily.billing_due &&
        !schedule.daily.paint_followup &&
        !schedule.daily.wallcovering_followup &&
        !schedule.daily.installs;
      if (!primaryEmail && !dailyBillingOnly) {
        result.skipped.push(
          `${label}: missing ${isOrgRun ? "notification primary email in Settings → Schedules" : "profile email"}`,
        );
        continue;
      }

      applyTimezone(schedule.timezone);
      const letterhead = normalizeLetterheadSettings(raw);
      const companyName = letterhead.company_name.trim() || "JobFlow";
      const gasPost = createCronEmailPoster(urls);
      const sendBase = {
        projects,
        primaryEmail,
        primaryName,
        companyName,
        companyAddress: letterhead.company_address,
        fromName: `${companyName} Dashboard`.trim(),
        gasUrl: urls.fieldOrderUrl || urls.dashboardUrl || "resend",
        logoUrl: letterhead.logo_url,
        gasPost,
      };

      if (slot === "daily" && schedule.daily.enabled) {
        if (schedule.daily.paint_followup) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: paint follow-up skipped (no primary email)`);
          } else if (followUpReminderHasContent("paint", projects)) {
            await sendFollowUpReminder({ kind: "paint", ...sendBase });
            result.sent.push(`${label}: paint follow-up`);
          } else {
            result.skipped.push(`${label}: paint follow-up (nothing due)`);
          }
        }
        if (schedule.daily.wallcovering_followup) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: wallcovering follow-up skipped (no primary email)`);
          } else if (followUpReminderHasContent("wallcovering", projects)) {
            await sendFollowUpReminder({ kind: "wallcovering", ...sendBase });
            result.sent.push(`${label}: wallcovering follow-up`);
          } else {
            result.skipped.push(`${label}: wallcovering follow-up (nothing due)`);
          }
        }
        if (schedule.daily.installs) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: installs skipped (no primary email)`);
          } else if (followUpReminderHasContent("installs", projects)) {
            await sendFollowUpReminder({ kind: "installs", ...sendBase });
            result.sent.push(`${label}: installs reminder`);
          } else {
            result.skipped.push(`${label}: installs (nothing upcoming)`);
          }
        }
        if (schedule.daily.billing_due) {
          if (billingDueDigestHasContent(projects)) {
            const billing = await sendBillingDueDigest({ ...sendBase });
            result.sent.push(
              `${label}: billing due 4-day reminder (${billing.pmCount} PM${billing.pmCount === 1 ? "" : "s"})`,
            );
          } else {
            result.skipped.push(
              `${label}: billing due (no jobs 4 days from due with ICBI PM email)`,
            );
          }
        }
      } else if (slot === "daily" && !schedule.daily.enabled) {
        result.skipped.push(`${label}: daily schedule disabled`);
      }

      if (slot === "weekly" && schedule.weekly.enabled) {
        if (schedule.weekly.combined_digest) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: combined digest skipped (no primary email)`);
          } else {
            await sendWeeklyTrackerDigest({ kind: "combined", ...sendBase });
            result.sent.push(`${label}: combined weekly digest`);
          }
        }
        if (schedule.weekly.wallcovering_digest) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: wallcovering digest skipped (no primary email)`);
          } else {
            await sendWeeklyTrackerDigest({ kind: "wallcovering", ...sendBase });
            result.sent.push(`${label}: wallcovering weekly digest`);
          }
        }
      } else if (slot === "weekly" && !schedule.weekly.enabled) {
        result.skipped.push(`${label}: weekly schedule disabled`);
      }

      if (slot === "monday") {
        if (!schedule.weekly.enabled) {
          result.skipped.push(`${label}: weekly schedule disabled (Monday site-ready)`);
        } else if (schedule.weekly.startup_site_ready) {
          if (!primaryEmail) {
            result.skipped.push(`${label}: Monday site-ready skipped (no primary email)`);
          } else if (siteReadyDigestHasContent(projects)) {
            await sendSiteReadyDigest({ ...sendBase });
            result.sent.push(`${label}: Monday site-ready digest`);
          } else {
            result.skipped.push(`${label}: Monday site-ready digest (nothing due)`);
          }
        } else {
          result.skipped.push(`${label}: Monday site-ready disabled`);
        }
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
