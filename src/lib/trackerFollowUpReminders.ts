import type { ProjectForm } from "../types/database";
import { collectProjectIcbiStaffCc, icbiSuperintendent, jobFullAddressOneLine, projectHasWallcovering } from "./jobInfo";
import {
  buildFieldPaintRow,
  buildFieldWcRows,
  loadAllProjectsForField,
} from "./fieldTrackerProject";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import {
  resolveTrackerNotificationRecipients,
  type TrackerNotificationBranding,
} from "./trackerNotificationEmail";
import { sendVendorEmail, type SendVendorEmailRequest } from "./sendVendorEmail";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";

export type FollowUpReminderKind = "paint" | "wallcovering" | "installs";

export type PaintFollowUpItem = {
  jobNumber: string;
  jobName: string;
  address: string;
  gcName: string;
  gcSuper: string;
  paintVendor: string;
  followUpDate: string;
  daysOverdue?: number;
};

export type WcFollowUpItem = {
  jobNumber: string;
  jobName: string;
  wallcoveringName: string;
  wcLabel: string;
  address: string;
  gcName: string;
  gcSuper: string;
  followUpDate: string;
  daysOverdue?: number;
  followUpLabel: string;
};

export type InstallReminderItem = {
  jobNumber: string;
  jobName: string;
  wallcoveringName: string;
  wcLabel: string;
  hasPanels: boolean;
  imageUrl: string;
  installDateFormatted: string;
  daysUntil: number;
};

export type PaintFollowUpBuckets = {
  overdue: PaintFollowUpItem[];
  dueToday: PaintFollowUpItem[];
};

export type WallcoveringFollowUpBuckets = {
  overdue: WcFollowUpItem[];
  dueToday: WcFollowUpItem[];
  esdOverdue: WcFollowUpItem[];
  esdDueToday: WcFollowUpItem[];
};

const INSTALL_LOOKAHEAD_DAYS = 14;

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntil(value: string): number | null {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const today = startOfDay(new Date());
  const target = startOfDay(parsed);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatDisplayDate(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return value.trim();
  return parsed.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function classifyFollowUp(dateValue: string): "overdue" | "today" | null {
  const until = daysUntil(dateValue);
  if (until === null) return null;
  if (until < 0) return "overdue";
  if (until === 0) return "today";
  return null;
}

function pushPaintFollowUp(
  buckets: PaintFollowUpBuckets,
  row: ReturnType<typeof buildFieldPaintRow>,
  dateValue: string,
): void {
  const kind = classifyFollowUp(dateValue);
  if (!kind) return;
  const until = daysUntil(dateValue)!;
  const item: PaintFollowUpItem = {
    jobNumber: row.jobNumber,
    jobName: row.jobName,
    address: row.jobAddress,
    gcName: row.gcName,
    gcSuper: row.gcSuper,
    paintVendor: row.paintVendor,
    followUpDate: formatDisplayDate(dateValue),
    daysOverdue: kind === "overdue" ? -until : undefined,
  };
  if (kind === "overdue") buckets.overdue.push(item);
  else buckets.dueToday.push(item);
}

export function collectPaintFollowUpReminders(projects: ProjectForm[]): PaintFollowUpBuckets {
  const buckets: PaintFollowUpBuckets = { overdue: [], dueToday: [] };
  for (const project of projects) {
    const row = buildFieldPaintRow(project);
    if (!row.jobNumber || row.tracker.noPaint) continue;
    pushPaintFollowUp(buckets, row, row.tracker.followUp);
  }
  return buckets;
}

function pushWcFollowUp(
  buckets: WallcoveringFollowUpBuckets,
  project: ProjectForm,
  row: ReturnType<typeof buildFieldWcRows>[number],
  dateValue: string,
  followUpLabel: string,
  esd: boolean,
): void {
  const kind = classifyFollowUp(dateValue);
  if (!kind) return;
  const until = daysUntil(dateValue)!;
  const j = project.jobInfo;
  const item: WcFollowUpItem = {
    jobNumber: row.jobNumber,
    jobName: row.jobName,
    wallcoveringName: row.wallcoveringName,
    wcLabel: row.label,
    address: jobFullAddressOneLine(project, j),
    gcName: project.contractor.trim(),
    gcSuper: icbiSuperintendent(j),
    followUpDate: formatDisplayDate(dateValue),
    daysOverdue: kind === "overdue" ? -until : undefined,
    followUpLabel,
  };
  const overdueKey = esd ? "esdOverdue" : "overdue";
  const todayKey = esd ? "esdDueToday" : "dueToday";
  if (kind === "overdue") buckets[overdueKey].push(item);
  else buckets[todayKey].push(item);
}

export function collectWallcoveringFollowUpReminders(
  projects: ProjectForm[],
): WallcoveringFollowUpBuckets {
  const buckets: WallcoveringFollowUpBuckets = {
    overdue: [],
    dueToday: [],
    esdOverdue: [],
    esdDueToday: [],
  };
  for (const project of projects) {
    if (!projectHasWallcovering(project.jobInfo)) continue;
    for (const row of buildFieldWcRows(project)) {
      pushWcFollowUp(buckets, project, row, row.line.followUp, "Follow-Up", false);
      pushWcFollowUp(buckets, project, row, row.line.esdFollowUp, "ESD Follow-Up", true);
    }
  }
  return buckets;
}

export function collectUpcomingInstallReminders(projects: ProjectForm[]): InstallReminderItem[] {
  const items: InstallReminderItem[] = [];
  for (const project of projects) {
    if (!projectHasWallcovering(project.jobInfo)) continue;
    for (const row of buildFieldWcRows(project)) {
      if (row.line.delivered) continue;
      const until = daysUntil(row.line.installDate);
      if (until === null || until < 0 || until > INSTALL_LOOKAHEAD_DAYS) continue;
      items.push({
        jobNumber: row.jobNumber,
        jobName: row.jobName,
        wallcoveringName: row.wallcoveringName,
        wcLabel: row.label,
        hasPanels: row.panels,
        imageUrl: row.imageUrl.trim(),
        installDateFormatted: formatDisplayDate(row.line.installDate),
        daysUntil: until,
      });
    }
  }
  items.sort((a, b) => a.daysUntil - b.daysUntil || a.jobNumber.localeCompare(b.jobNumber));
  return items;
}

function digestFooter(companyName: string, companyAddress: string): string {
  return `<tr>
                  <td style="padding: 15px 20px; background-color: #3a4d5c; text-align: center;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${escHtml(companyName)} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #b8d4e6; font-family: Arial, Helvetica, sans-serif;">
                      ${escHtml(companyAddress)}
                    </p>
                  </td>
                </tr>`;
}

function paintFollowUpSection(
  title: string,
  items: PaintFollowUpItem[],
  showDaysOverdue: boolean,
  bgColor: string,
  borderColor: string,
): string {
  if (!items.length) return "";
  let html = `<tr><td style="padding: 20px 20px 10px 20px;">
                    <h2 style="margin: 0; font-size: 18px; color: ${borderColor}; font-weight: bold; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${borderColor}; padding-bottom: 8px;">${escHtml(title)}</h2>
                  </td></tr>`;
  items.forEach((item, index) => {
    const rowBg = index % 2 === 0 ? "#ffffff" : "#fafafa";
    html += `<tr><td style="padding: 10px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: ${rowBg}; border-left: 4px solid ${borderColor}; border-collapse: collapse;">
                      <tr><td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #333;">
                            <span style="color: #1a73e8;">${escHtml(item.jobNumber)}</span> - ${escHtml(item.jobName)}
                          </p>
                          <p style="margin: 0 0 5px 0; font-size: 13px; color: #666;"><strong>Address:</strong> ${escHtml(item.address || "N/A")}</p>
                          <p style="margin: 0 0 5px 0; font-size: 13px; color: #666;"><strong>GC:</strong> ${escHtml(item.gcName || "N/A")} | <strong>Super:</strong> ${escHtml(item.gcSuper || "N/A")}</p>
                          <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Paint Vendor:</strong> ${escHtml(item.paintVendor || "N/A")}</p>
                          <p style="margin: 0; font-size: 13px;"><strong style="color: ${borderColor};">Follow-Up Date:</strong>
                            <span style="background-color: ${bgColor}; padding: 2px 8px; border-radius: 3px;">${escHtml(item.followUpDate)}</span>
                            ${showDaysOverdue && item.daysOverdue ? `<span style="color: #d32f2f; font-weight: bold; margin-left: 5px;">(${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue)</span>` : ""}
                          </p>
                      </td></tr>
                    </table>
                  </td></tr>`;
  });
  return html;
}

function wcFollowUpSection(title: string, items: WcFollowUpItem[], showDaysOverdue: boolean): string {
  if (!items.length) return "";
  let html = `<tr><td style="padding: 30px 20px 10px 20px;">
                    <h2 style="margin: 0; font-size: 18px; color: #d32f2f; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">${escHtml(title)}</h2>
                  </td></tr>`;
  for (const item of items) {
    html += `<tr><td style="padding: 0 20px 20px 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-left: 4px solid #d32f2f; background-color: #ffffff; border-collapse: collapse;">
                      <tr><td style="font-family: Arial, Helvetica, sans-serif;">
                          <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #1a73e8;">${escHtml(item.jobNumber)} - ${escHtml(item.jobName)}</p>
                          <p style="margin: 0 0 5px 0; font-size: 13px; color: #666;"><strong>Material:</strong> ${escHtml(item.wallcoveringName)} (${escHtml(item.wcLabel)})</p>
                          ${item.address ? `<p style="margin: 0 0 5px 0; font-size: 13px; color: #666;"><strong>Address:</strong> ${escHtml(item.address)}</p>` : ""}
                          <p style="margin: 0 0 10px 0; font-size: 13px; color: #666;"><strong>GC:</strong> ${escHtml(item.gcName || "N/A")} | <strong>Super:</strong> ${escHtml(item.gcSuper || "N/A")}</p>
                          <p style="margin: 0; font-size: 13px; color: #d32f2f; font-weight: bold;"><strong>${escHtml(item.followUpLabel)}:</strong> ${escHtml(item.followUpDate)}${showDaysOverdue && item.daysOverdue ? ` (${item.daysOverdue} days overdue)` : ""}</p>
                      </td></tr>
                    </table>
                  </td></tr>`;
  }
  return html;
}

export function buildPaintFollowUpEmailHtml(
  buckets: PaintFollowUpBuckets,
  branding: TrackerNotificationBranding,
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());

  let html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
                <tr><td style="background-color: #3a4d5c; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">Paint Follow-Up Reminders</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${today}</p>
                  </td></tr>
                <tr><td style="padding: 0; background-color: #d4e6f1;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-bottom: 3px solid #3a4d5c;">
                      <tr>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:32px;font-weight:bold;color:#d32f2f;">${buckets.overdue.length}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Overdue</p></td>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:32px;font-weight:bold;color:#ff9800;">${buckets.dueToday.length}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Due Today</p></td>
                      </tr>
                    </table>
                  </td></tr>`;

  html += paintFollowUpSection("⚠️ Overdue Follow-Ups", buckets.overdue, true, "#ffebee", "#d32f2f");
  html += paintFollowUpSection("📅 Follow-Ups Due Today", buckets.dueToday, false, "#fff3e0", "#ff9800");
  html += digestFooter(companyName, companyAddress);
  html += `</table></td></tr></table></body></html>`;
  return html;
}

export function buildWallcoveringFollowUpEmailHtml(
  buckets: WallcoveringFollowUpBuckets,
  branding: TrackerNotificationBranding,
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());
  const totalOverdue = buckets.overdue.length + buckets.esdOverdue.length;
  const totalDueToday = buckets.dueToday.length + buckets.esdDueToday.length;

  let html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
                <tr><td style="background-color: #3a4d5c; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">Wallcovering Follow-Up Reminders</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${today}</p>
                  </td></tr>
                <tr><td style="padding: 0; background-color: #d4e6f1;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-bottom: 3px solid #3a4d5c;">
                      <tr>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:32px;font-weight:bold;color:#d32f2f;">${totalOverdue}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Overdue</p></td>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:32px;font-weight:bold;color:#ff9800;">${totalDueToday}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Due Today</p></td>
                      </tr>
                    </table>
                  </td></tr>`;

  html += wcFollowUpSection("⚠️ Overdue Follow-Ups", buckets.overdue, true);
  html += wcFollowUpSection("⚠️ Overdue ESD Follow-Ups", buckets.esdOverdue, true);
  html += wcFollowUpSection("📅 Follow-Ups Due Today", buckets.dueToday, false);
  html += wcFollowUpSection("📅 ESD Follow-Ups Due Today", buckets.esdDueToday, false);
  html += digestFooter(companyName, companyAddress);
  html += `</table></td></tr></table></body></html>`;
  return html;
}

export function buildUpcomingInstallsReminderEmailHtml(
  items: InstallReminderItem[],
  branding: TrackerNotificationBranding,
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());

  let html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
                <tr><td style="background-color: #3a4d5c; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">📅 Upcoming Installations</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${today}</p>
                  </td></tr>
                <tr><td style="padding: 10px 20px;">
                    <table width="100%" cellpadding="12" cellspacing="0" border="0" style="background-color: #e8eaf6; border-left: 5px solid #3f51b5; border-radius: 4px;">
                      <tr><td>
                          <p style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: #3f51b5;">
                            Next ${INSTALL_LOOKAHEAD_DAYS} days
                            <span style="background-color: #3f51b5; color: white; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px;">${items.length}</span>
                          </p>`;

  for (const item of items) {
    const material = item.imageUrl
      ? `<a href="${escHtml(item.imageUrl)}" style="color: #1a73e8; text-decoration: none;">${escHtml(item.wallcoveringName)}</a>`
      : escHtml(item.wallcoveringName);
    const panels = item.hasPanels
      ? ' <span style="background-color: #ff5722; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">PANELS</span>'
      : "";
    html += `<table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 4px; margin-bottom: 10px;">
                            <tr><td style="border-left: 3px solid #3f51b5;">
                                <p style="margin: 0 0 5px 0; font-size: 15px;"><strong style="color: #1a73e8;">${escHtml(item.jobNumber)}</strong> - ${escHtml(item.jobName)}</p>
                                <p style="margin: 0 0 3px 0; font-size: 13px; color: #666;">Material: ${material} (${escHtml(item.wcLabel)})${panels}</p>
                                <p style="margin: 0; font-size: 13px; color: #3f51b5; font-weight: bold;">Install Date: ${escHtml(item.installDateFormatted)} (${item.daysUntil} day${item.daysUntil === 1 ? "" : "s"})</p>
                              </td></tr>
                          </table>`;
  }

  html += `</td></tr></table></td></tr>`;
  html += digestFooter(companyName, companyAddress);
  html += `</table></td></tr></table></body></html>`;
  return html;
}

export function followUpReminderHasContent(
  kind: FollowUpReminderKind,
  projects: ProjectForm[],
): boolean {
  if (kind === "paint") {
    const b = collectPaintFollowUpReminders(projects);
    return b.overdue.length > 0 || b.dueToday.length > 0;
  }
  if (kind === "wallcovering") {
    const b = collectWallcoveringFollowUpReminders(projects);
    return (
      b.overdue.length > 0 ||
      b.dueToday.length > 0 ||
      b.esdOverdue.length > 0 ||
      b.esdDueToday.length > 0
    );
  }
  return collectUpcomingInstallReminders(projects).length > 0;
}

export async function sendFollowUpReminder(options: {
  kind: FollowUpReminderKind;
  projects: ProjectForm[];
  primaryEmail: string;
  primaryName: string;
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  /** Server cron: direct GAS POST instead of browser proxy. */
  gasPost?: GasEmailPost;
}): Promise<void> {
  if (!followUpReminderHasContent(options.kind, options.projects)) {
    throw new Error("Nothing due — no reminder email sent.");
  }

  const recipients = resolveTrackerNotificationRecipients(
    options.primaryEmail,
    collectProjectIcbiStaffCc(options.projects),
  );
  if (!recipients) {
    throw new Error("Set email on your Profile (Settings → Profile & letterhead).");
  }

  const branding: TrackerNotificationBranding = {
    companyName: options.companyName,
    companyAddress: options.companyAddress,
    primaryName: options.primaryName,
  };

  let subject: string;
  let html: string;

  if (options.kind === "paint") {
    const buckets = collectPaintFollowUpReminders(options.projects);
    subject = `Paint Follow-Up Reminders — ${formatTodayLong()}`;
    html = buildPaintFollowUpEmailHtml(buckets, branding);
  } else if (options.kind === "wallcovering") {
    const buckets = collectWallcoveringFollowUpReminders(options.projects);
    subject = `Wallcovering Follow-Up Reminders — ${formatTodayLong()}`;
    html = buildWallcoveringFollowUpEmailHtml(buckets, branding);
  } else {
    const items = collectUpcomingInstallReminders(options.projects);
    subject = `Upcoming Installations — ${formatTodayLong()}`;
    html = buildUpcomingInstallsReminderEmailHtml(items, branding);
  }

  const htmlForSend = await embedLogoUrlInHtml(html, options.logoUrl ?? "");

  const payload: SendVendorEmailRequest = {
    to: recipients.to,
    cc: recipients.cc,
    subject,
    html: htmlForSend,
    text: "Follow-up reminder — open in an HTML-capable email client.",
    from_name: options.fromName,
  };

  if (options.gasPost) {
    await options.gasPost(options.gasUrl, payload);
    return;
  }

  await sendVendorEmail(payload, { gasUrl: options.gasUrl });
}

export async function sendFollowUpReminderViaGasDirect(
  options: Omit<Parameters<typeof sendFollowUpReminder>[0], "gasPost">,
): Promise<void> {
  return sendFollowUpReminder({ ...options, gasPost: sendVendorEmailGasDirect });
}

export async function loadProjectsForFollowUpReminders(): Promise<{
  projects: ProjectForm[];
  error: string | null;
}> {
  return loadAllProjectsForField();
}
