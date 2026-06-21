import type { ProjectForm } from "../types/database";
import type { PaintTrackerState } from "../types/fieldTracker";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import type { SuperEmail } from "./paintUserSettings";
import { sendVendorEmail } from "./sendVendorEmail";

export type PaintNotificationJobData = {
  jobNumber: string;
  jobName: string;
  address: string;
  gcName: string;
  gcSuper: string;
  startDate: string;
  paintVendor: string;
  creativeTeam: string;
  nightsWeekends: boolean;
  revisionNotes?: string;
};

export type TrackerNotificationBranding = {
  companyName: string;
  companyAddress: string;
  primaryName: string;
};

export type TrackerNotificationRecipients = {
  to: string[];
  cc: string[];
};

export type PaintTrackerNotificationKind = "approval" | "revision" | "match_existing";

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDisplayDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  }
  return trimmed;
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
}

export function projectToPaintNotificationJobData(
  project: ProjectForm,
  tracker: PaintTrackerState,
): PaintNotificationJobData {
  const j = project.jobInfo;
  const address = [project.job_address, project.job_address2, j.job_city, j.job_zip]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

  return {
    jobNumber: project.job_number.trim(),
    jobName: project.job_name.trim(),
    address,
    gcName: project.contractor.trim(),
    gcSuper: j.gc_superintendent.trim(),
    startDate: j.start_date.trim(),
    paintVendor: tracker.paintVendor,
    creativeTeam: tracker.creativeTeam.trim(),
    nightsWeekends: tracker.nightsWeekends,
    revisionNotes: tracker.revisionNotes.trim(),
  };
}

export function resolveTrackerNotificationRecipients(
  primaryEmail: string,
  superEmails: SuperEmail[],
): TrackerNotificationRecipients | null {
  const to = primaryEmail.trim();
  if (!to) return null;
  const cc = superEmails.map((s) => s.email.trim()).filter(Boolean);
  return { to: [to], cc };
}

export function detectPaintTrackerNotificationKinds(
  prev: PaintTrackerState,
  next: PaintTrackerState,
): PaintTrackerNotificationKind[] {
  const kinds: PaintTrackerNotificationKind[] = [];
  if (!prev.approved && next.approved) kinds.push("approval");
  if (!prev.revision && next.revision) kinds.push("revision");
  if (!prev.matchExisting && next.matchExisting) kinds.push("match_existing");
  return kinds;
}

export function buildPaintMatchExistingSubject(
  jobData: PaintNotificationJobData,
  primaryName: string,
): string {
  const pm = primaryName.trim() || "PM";
  return `Match Existing Colors: ${jobData.jobNumber} - ${jobData.jobName} (${pm})`;
}

export function buildPaintApprovalSubject(jobData: PaintNotificationJobData): string {
  return `✅ Paint Submittal Approved: ${jobData.jobNumber} - ${jobData.jobName}`;
}

export function buildPaintRevisionSubject(
  jobData: PaintNotificationJobData,
  primaryName: string,
): string {
  const pm = primaryName.trim() || "PM";
  return `⚠️ Revision Needed: ${jobData.jobNumber} – ${jobData.jobName} (${pm})`;
}

export function buildPaintApprovalEmailHtml(
  jobData: PaintNotificationJobData,
  branding: TrackerNotificationBranding,
): string {
  const startDateDisplay = formatDisplayDate(jobData.startDate);
  const companyName = escHtml(branding.companyName.trim() || "JobFlow");
  const companyAddress = escHtml(branding.companyAddress.trim());
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const today = escHtml(formatTodayLong());

  const startDateRow = startDateDisplay
    ? `<tr>
                        <td style="font-weight: bold; color: #666;">Start Date:</td>
                        <td style="color: #333; font-weight: bold;">${escHtml(startDateDisplay)}</td>
                      </tr>`
    : "";

  const nightsRow = jobData.nightsWeekends
    ? `<tr>
                        <td style="font-weight: bold; color: #666;">Special Notes:</td>
                        <td style="color: #d32f2f; font-weight: bold;">⚠️ NIGHTS/WEEKENDS</td>
                      </tr>`
    : "";

  const nightsNextStep = jobData.nightsWeekends
    ? '<li style="margin-bottom: 8px; color: #d32f2f; font-weight: bold;">⚠️ Remember: This is a nights/weekends project</li>'
    : "";

  const gcSuperSuffix = jobData.gcSuper ? `: ${escHtml(jobData.gcSuper)}` : "";

  return `<html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px;">
                <tr>
                  <td style="background-color: #4caf50; padding: 25px 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px;">✅ Paint Submittal Approved!</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${today}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px 20px 20px 20px;">
                    <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                      <p style="margin: 0; color: #2e7d32; font-size: 16px; font-weight: bold;">
                        The paint submittal has been approved by the GC. You can now proceed with ordering materials.
                      </p>
                    </div>
                    <h2 style="margin: 0 0 20px 0; font-size: 20px; color: #333;">Job Information</h2>
                    <table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #f8f9fa; border-radius: 4px;">
                      <tr>
                        <td style="width: 150px; font-weight: bold; color: #666;">Job Number:</td>
                        <td style="color: #1a73e8; font-weight: bold; font-size: 16px;">${escHtml(jobData.jobNumber)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666;">Job Name:</td>
                        <td style="color: #333;">${escHtml(jobData.jobName)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666;">Address:</td>
                        <td style="color: #333;">${escHtml(jobData.address || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666;">GC:</td>
                        <td style="color: #333;">${escHtml(jobData.gcName || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666;">GC Super:</td>
                        <td style="color: #333;">${escHtml(jobData.gcSuper || "N/A")}</td>
                      </tr>
                      ${startDateRow}
                      <tr>
                        <td style="font-weight: bold; color: #666;">Paint Vendor:</td>
                        <td style="color: #333; font-weight: bold;">${escHtml(jobData.paintVendor || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666;">Creative Team:</td>
                        <td style="color: #333;">${escHtml(jobData.creativeTeam || "N/A")}</td>
                      </tr>
                      ${nightsRow}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 30px 20px;">
                    <div style="background-color: #e3f2fd; border-left: 4px solid #1976d2; padding: 15px; border-radius: 4px;">
                      <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1976d2;">📋 Next Steps:</h3>
                      <ul style="margin: 0; padding-left: 20px; color: #333;">
                        <li style="margin-bottom: 8px;">Order paint materials from ${escHtml(jobData.paintVendor || "vendor")}</li>
                        <li style="margin-bottom: 8px;">Coordinate delivery schedule with GC Super${gcSuperSuffix}</li>
                        <li style="margin-bottom: 8px;">Update job schedule if needed</li>
                        ${nightsNextStep}
                      </ul>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px; background-color: #3a4d5c; text-align: center; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${companyName} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #b8d4e6; font-family: Arial, Helvetica, sans-serif;">
                      ${companyAddress}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

export function buildPaintMatchExistingEmailHtml(
  jobData: PaintNotificationJobData,
  branding: TrackerNotificationBranding,
): string {
  const startDateDisplay = formatDisplayDate(jobData.startDate);
  const companyName = escHtml(branding.companyName.trim() || "JobFlow");
  const companyAddress = escHtml(branding.companyAddress.trim());
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const today = escHtml(formatTodayLong());
  const gcSuperSuffix = jobData.gcSuper ? `: ${escHtml(jobData.gcSuper)}` : "";

  const startDateRow = startDateDisplay
    ? `<tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Start Date:</td>
                        <td style="color: #333; font-weight: bold; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(startDateDisplay)}</td>
                      </tr>`
    : "";

  const nightsRow = jobData.nightsWeekends
    ? `<tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Special Notes:</td>
                        <td style="color: #d32f2f; font-weight: bold; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">⚠️ NIGHTS/WEEKENDS</td>
                      </tr>`
    : "";

  const nightsNextStep = jobData.nightsWeekends
    ? '<li style="margin-bottom: 8px; color: #d32f2f; font-weight: bold;">⚠️ Remember: This is a nights/weekends project</li>'
    : "";

  return `<html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-collapse: collapse;">
                <tr>
                  <td style="background-color: #9c27b0; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">Match Existing Colors</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">${today}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px 20px 20px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #f3e5f5; border-left: 4px solid #9c27b0; border-radius: 4px; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0; color: #6a1b9a; font-size: 16px; font-weight: bold;">
                            This job requires matching existing colors. No submittal approval process needed.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 20px 20px;">
                    <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #333; font-family: Arial, Helvetica, sans-serif; font-weight: bold;">Job Information</h2>
                    <table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #f8f9fa; border-collapse: collapse;">
                      <tr>
                        <td width="150" style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Job Number:</td>
                        <td style="color: #1a73e8; font-weight: bold; font-size: 16px; font-family: Arial, Helvetica, sans-serif; padding: 10px;">${escHtml(jobData.jobNumber)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Job Name:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.jobName)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Address:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.address || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">GC:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.gcName || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">GC Super:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.gcSuper || "N/A")}</td>
                      </tr>
                      ${startDateRow}
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Paint Vendor:</td>
                        <td style="color: #333; font-weight: bold; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.paintVendor || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Creative Team:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.creativeTeam || "N/A")}</td>
                      </tr>
                      ${nightsRow}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 30px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #e3f2fd; border-left: 4px solid #1976d2; border-radius: 4px; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: Arial, Helvetica, sans-serif;">
                          <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1976d2; font-family: Arial, Helvetica, sans-serif;">📋 Next Steps:</h3>
                          <ul style="margin: 0; padding-left: 20px; color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.6;">
                            <li style="margin-bottom: 8px;">Visit job site to identify and document existing paint colors</li>
                            <li style="margin-bottom: 8px;">Take samples or use color matching tools</li>
                            <li style="margin-bottom: 8px;">Coordinate with ${escHtml(jobData.paintVendor || "paint vendor")} for color matching</li>
                            <li style="margin-bottom: 8px;"><strong>Order brush outs and submit for records only (no approval needed)</strong></li>
                            <li style="margin-bottom: 8px;">Order matched paint materials</li>
                            <li style="margin-bottom: 8px;">Schedule with GC Super${gcSuperSuffix}</li>
                            ${nightsNextStep}
                          </ul>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px 20px; background-color: #3a4d5c; text-align: center;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${companyName} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #b8d4e6; font-family: Arial, Helvetica, sans-serif;">
                      ${companyAddress}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

export function buildPaintRevisionEmailHtml(
  jobData: PaintNotificationJobData,
  branding: TrackerNotificationBranding,
  additionalNotes?: string,
): string {
  const startDateDisplay = formatDisplayDate(jobData.startDate);
  const companyName = escHtml(branding.companyName.trim() || "JobFlow");
  const companyAddress = escHtml(branding.companyAddress.trim());
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const today = escHtml(formatTodayLong());
  const notes = additionalNotes?.trim() ?? "";

  let startDateRow = "";
  if (startDateDisplay) {
    startDateRow = `<tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Start Date:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(startDateDisplay)}</td>
                      </tr>`;
  }

  let revisionNotesBlock = "";
  if (jobData.revisionNotes) {
    revisionNotesBlock = `<tr>
                  <td style="padding: 0 20px 20px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #fff3cd; border-left: 4px solid #856404; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #856404; font-family: Arial, Helvetica, sans-serif;">📝 Revision Notes from Tracker:</p>
                          <p style="margin: 0; color: #333; white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5;">${escHtml(jobData.revisionNotes)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
  }

  let additionalNotesBlock = "";
  if (notes) {
    additionalNotesBlock = `<tr>
                  <td style="padding: 0 20px 20px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #e3f2fd; border-left: 4px solid #1976d2; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #1976d2; font-family: Arial, Helvetica, sans-serif;">💬 Additional Notes:</p>
                          <p style="margin: 0; color: #333; white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5;">${escHtml(notes)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
  }

  return `<html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <!--[if mso]>
        <style type="text/css">
          body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
        </style>
        <![endif]-->
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-collapse: collapse;">
                <tr>
                  <td style="background-color: #ff9800; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">⚠️ Revision Required</h1>
                    <p style="margin: 6px 0 0 0; color: #ffffff; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">${today}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px 20px 20px 20px;">
                    <h2 style="margin: 0 0 15px 0; font-size: 20px; color: #333; font-family: Arial, Helvetica, sans-serif; font-weight: bold;">Job Information</h2>
                    <table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #f8f9fa; border-collapse: collapse;">
                      <tr>
                        <td width="150" style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Job Number:</td>
                        <td style="color: #1a73e8; font-weight: bold; font-size: 16px; font-family: Arial, Helvetica, sans-serif; padding: 10px;">${escHtml(jobData.jobNumber)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Job Name:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.jobName)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Address:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.address || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">GC:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.gcName || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">GC Super:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.gcSuper || "N/A")}</td>
                      </tr>
                      ${startDateRow}
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Paint Vendor:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.paintVendor || "N/A")}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; color: #666; font-family: Arial, Helvetica, sans-serif; font-size: 13px; vertical-align: top; padding: 10px;">Creative Team:</td>
                        <td style="color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 10px;">${escHtml(jobData.creativeTeam || "N/A")}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${revisionNotesBlock}
                ${additionalNotesBlock}
                <tr>
                  <td style="padding: 0 20px 30px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #ffebee; border-left: 4px solid #d32f2f; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #d32f2f; font-family: Arial, Helvetica, sans-serif;">⚠️ Action Required:</p>
                          <p style="margin: 0; color: #333; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5;">This paint submittal requires revision before it can be resubmitted for approval. Please review the notes above and make the necessary changes.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px; background-color: #3a4d5c; text-align: center;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${companyName} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #b8d4e6; font-family: Arial, Helvetica, sans-serif;">
                      ${companyAddress}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

export async function sendPaintTrackerNotifications(options: {
  kinds: PaintTrackerNotificationKind[];
  project: ProjectForm;
  tracker: PaintTrackerState;
  primaryEmail: string;
  primaryName: string;
  superEmails: SuperEmail[];
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
}): Promise<string[]> {
  const {
    kinds,
    project,
    tracker,
    primaryEmail,
    primaryName,
    superEmails,
    companyName,
    companyAddress,
    fromName,
    gasUrl,
    logoUrl = "",
  } = options;

  const jobNumber = project.job_number.trim();
  if (!jobNumber || !kinds.length) return [];

  const recipients = resolveTrackerNotificationRecipients(primaryEmail, superEmails);
  if (!recipients) {
    throw new Error("Set a notification primary email in Settings → Paint & email.");
  }

  const jobData = projectToPaintNotificationJobData(project, tracker);
  const branding: TrackerNotificationBranding = {
    companyName,
    companyAddress,
    primaryName,
  };

  const sent: string[] = [];

  for (const kind of kinds) {
    let subject: string;
    let html: string;
    if (kind === "approval") {
      subject = buildPaintApprovalSubject(jobData);
      html = buildPaintApprovalEmailHtml(jobData, branding);
    } else if (kind === "revision") {
      subject = buildPaintRevisionSubject(jobData, primaryName);
      html = buildPaintRevisionEmailHtml(jobData, branding);
    } else {
      subject = buildPaintMatchExistingSubject(jobData, primaryName);
      html = buildPaintMatchExistingEmailHtml(jobData, branding);
    }

    const htmlForSend = await embedLogoUrlInHtml(html, logoUrl);

    await sendVendorEmail(
      {
        to: recipients.to,
        cc: recipients.cc,
        subject,
        html: htmlForSend,
        text: "This message contains HTML formatting. Open in an HTML-capable email client.",
        from_name: fromName,
      },
      { gasUrl },
    );

    sent.push(kind);
  }

  return sent;
}
