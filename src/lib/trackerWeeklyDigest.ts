import type { ProjectForm } from "../types/database";
import { collectProjectForemanCc, projectHasWallcovering } from "./jobInfo";
import {
  buildFieldPaintRow,
  buildFieldWcRows,
  loadAllProjectsForField,
} from "./fieldTrackerProject";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import type { SuperEmail } from "./paintUserSettings";
import {
  resolveTrackerNotificationRecipients,
  type TrackerNotificationBranding,
} from "./trackerNotificationEmail";
import { sendVendorEmail, type SendVendorEmailRequest } from "./sendVendorEmail";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";
import type { WcTrackerLineState } from "../types/fieldTracker";

export type DigestJobItem = {
  job: string;
  name: string;
  address?: string;
  super?: string;
  material?: string;
  label?: string;
  status?: string;
  revisionNotes?: string;
  startDate?: string;
  daysUntil?: number;
};

export type WallcoveringDigestAlerts = {
  needsOrdering: DigestJobItem[];
  awaitingApproval: DigestJobItem[];
  overdueApproval: DigestJobItem[];
  approvedNotOrdered: DigestJobItem[];
  upcomingInstalls: DigestJobItem[];
};

export type PaintDigestAlerts = {
  needsOrdering: DigestJobItem[];
  awaitingApproval: DigestJobItem[];
  overdueApproval: DigestJobItem[];
  needsRevision: DigestJobItem[];
  upcomingStarts: DigestJobItem[];
};

const UPCOMING_DAYS = 7;

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
  return parsed.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function wcApprovedStatus(line: WcTrackerLineState): string {
  if (line.shops && !line.materialOrder) return "Pending shops";
  if (line.fieldMeasurement && !line.materialOrder) return "Pending field measurement";
  return "Approved — material not ordered";
}

export function collectPaintDigestAlerts(projects: ProjectForm[]): PaintDigestAlerts {
  const alerts: PaintDigestAlerts = {
    needsOrdering: [],
    awaitingApproval: [],
    overdueApproval: [],
    needsRevision: [],
    upcomingStarts: [],
  };

  for (const project of projects) {
    const row = buildFieldPaintRow(project);
    if (!row.jobNumber || row.tracker.noPaint) continue;

    const t = row.tracker;
    const item: DigestJobItem = {
      job: row.jobNumber,
      name: row.jobName,
      address: row.jobAddress,
      super: row.gcSuper,
      revisionNotes: t.revisionNotes.trim() || undefined,
    };

    if (t.revision && !t.approved) {
      alerts.needsRevision.push(item);
    } else if (t.submittedForApproval && !t.approved) {
      alerts.overdueApproval.push({ ...item, status: "Submitted for approval" });
    } else if (t.submittalOrdered && !t.approved) {
      alerts.awaitingApproval.push({ ...item, status: "Submittal ordered" });
    } else if (!t.submittalOrdered && !t.approved) {
      alerts.needsOrdering.push({
        ...item,
        status: t.matchExisting ? "Match existing — order brush outs" : undefined,
      });
    }

    const until = daysUntil(row.startDate);
    if (until !== null && until >= 0 && until <= UPCOMING_DAYS && !t.approved && !t.noPaint) {
      alerts.upcomingStarts.push({
        ...item,
        startDate: formatDisplayDate(row.startDate),
        daysUntil: until,
      });
    }
  }

  return alerts;
}

export function collectWallcoveringDigestAlerts(projects: ProjectForm[]): WallcoveringDigestAlerts {
  const alerts: WallcoveringDigestAlerts = {
    needsOrdering: [],
    awaitingApproval: [],
    overdueApproval: [],
    approvedNotOrdered: [],
    upcomingInstalls: [],
  };

  for (const project of projects) {
    if (!projectHasWallcovering(project.jobInfo)) continue;
    for (const row of buildFieldWcRows(project)) {
      const line = row.line;
      const item: DigestJobItem = {
        job: row.jobNumber,
        name: row.jobName,
        material: row.wallcoveringName,
        label: row.label,
      };

      if (line.approved && !line.materialOrder && !line.delivered) {
        alerts.approvedNotOrdered.push({ ...item, status: wcApprovedStatus(line) });
      } else if (!line.ordered && !line.delivered) {
        alerts.needsOrdering.push(item);
      } else if (line.ordered && !line.sentForApproval && !line.approved) {
        alerts.awaitingApproval.push({ ...item, status: "Samples ordered" });
      } else if (line.sentForApproval && !line.approved) {
        alerts.overdueApproval.push({ ...item, status: "Awaiting approval" });
      }

      const until = daysUntil(line.installDate);
      if (until !== null && until >= 0 && until <= UPCOMING_DAYS) {
        alerts.upcomingInstalls.push({
          ...item,
          status: `Install in ${until} day${until === 1 ? "" : "s"}`,
        });
      }
    }
  }

  return alerts;
}

function digestFooter(companyName: string, companyAddress: string): string {
  return `<tr>
                  <td style="padding: 20px; background-color: #3a4d5c; text-align: center; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${escHtml(companyName)} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #b8d4e6; font-family: Arial, Helvetica, sans-serif;">
                      ${escHtml(companyAddress)}
                    </p>
                  </td>
                </tr>`;
}

function wcItemBlock(item: DigestJobItem, borderColor: string, extra?: string): string {
  return `<table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 4px; margin-bottom: 10px;">
                            <tr>
                              <td style="border-left: 3px solid ${borderColor};">
                                <p style="margin: 0 0 5px 0; font-size: 15px;">
                                  <strong style="color: #1a73e8;">${escHtml(item.job)}</strong> - ${escHtml(item.name)}
                                </p>
                                <p style="margin: 0 0 3px 0; font-size: 13px; color: #666;">Material: ${escHtml(item.material ?? "")} (${escHtml(item.label ?? "")})</p>
                                ${item.status ? `<p style="margin: 0; font-size: 12px; color: #666; font-style: italic;">${escHtml(item.status)}</p>` : ""}
                                ${extra ?? ""}
                              </td>
                            </tr>
                          </table>`;
}

function paintItemBlock(item: DigestJobItem, borderColor: string, extra?: string): string {
  let notes = "";
  if (item.revisionNotes) {
    notes = `<p style="margin: 8px 0 0 0; padding: 8px; background-color: #fff3cd; border-left: 3px solid #856404; border-radius: 3px;">
                                  <strong style="font-size: 12px; color: #856404;">Revision Notes:</strong><br>
                                  <span style="font-size: 12px; color: #333;">${escHtml(item.revisionNotes)}</span>
                                </p>`;
  }
  return `<table width="100%" cellpadding="10" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 4px; margin-bottom: 10px;">
                            <tr>
                              <td style="border-left: 3px solid ${borderColor};">
                                <p style="margin: 0 0 5px 0; font-size: 15px;">
                                  <strong style="color: #1a73e8;">${escHtml(item.job)}</strong> - ${escHtml(item.name)}
                                </p>
                                ${item.address ? `<p style="margin: 0 0 3px 0; font-size: 13px; color: #666;">Address: ${escHtml(item.address)}</p>` : ""}
                                ${item.super ? `<p style="margin: 0 0 3px 0; font-size: 13px; color: #666;">Super: ${escHtml(item.super)}</p>` : ""}
                                ${item.status ? `<p style="margin: 0; font-size: 12px; color: #999; font-style: italic;">${escHtml(item.status)}</p>` : ""}
                                ${extra ?? ""}
                                ${notes}
                              </td>
                            </tr>
                          </table>`;
}

function alertSection(
  title: string,
  count: number,
  bg: string,
  border: string,
  titleColor: string,
  blocks: string,
): string {
  if (!blocks) return "";
  return `<tr>
                  <td style="padding: 10px 20px;">
                    <table width="100%" cellpadding="12" cellspacing="0" border="0" style="background-color: ${bg}; border-left: 5px solid ${border}; border-radius: 4px;">
                      <tr>
                        <td>
                          <p style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: ${titleColor};">
                            ${title}
                            <span style="background-color: ${border}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px;">${count}</span>
                          </p>
                          ${blocks}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

export function buildCombinedWeeklyDigestHtml(
  wallcoveringAlerts: WallcoveringDigestAlerts,
  paintAlerts: PaintDigestAlerts,
  branding: TrackerNotificationBranding,
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());

  const totalIssues =
    wallcoveringAlerts.needsOrdering.length +
    wallcoveringAlerts.overdueApproval.length +
    wallcoveringAlerts.approvedNotOrdered.length +
    paintAlerts.needsOrdering.length +
    paintAlerts.overdueApproval.length +
    paintAlerts.needsRevision.length;

  let html = `<html>
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px;">
                <tr>
                  <td style="background-color: #3a4d5c; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Weekly Submittal Status</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 16px;">${today}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="background-color: #d4e6f1; border-left: 4px solid #3a4d5c; border-radius: 4px;">
                      <tr><td>
                          <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #3a4d5c;">📊 Quick Summary:</p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Total items needing attention: <strong style="color: #d32f2f;">${totalIssues}</strong></p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Wallcovering items: <strong>${wallcoveringAlerts.needsOrdering.length + wallcoveringAlerts.awaitingApproval.length + wallcoveringAlerts.overdueApproval.length}</strong></p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Paint items: <strong>${paintAlerts.needsOrdering.length + paintAlerts.awaitingApproval.length + paintAlerts.overdueApproval.length + paintAlerts.needsRevision.length}</strong></p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Paint items needing revision: <strong style="color: #f57c00;">${paintAlerts.needsRevision.length}</strong></p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Upcoming installations: <strong>${wallcoveringAlerts.upcomingInstalls.length}</strong></p>
                          <p style="margin: 5px 0; font-size: 14px; color: #3a4d5c;">• Upcoming paint starts: <strong>${paintAlerts.upcomingStarts.length}</strong></p>
                      </td></tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding: 20px 20px 10px 20px;"><h2 style="margin: 0; font-size: 22px; color: #3a4d5c; border-bottom: 2px solid #3a4d5c; padding-bottom: 8px;">Wallcovering Tracker</h2></td></tr>`;

  html += alertSection(
    "⚠️ Submittal Approved - Material Not Yet Ordered",
    wallcoveringAlerts.approvedNotOrdered.length,
    "#ffebee",
    "#d32f2f",
    "#d32f2f",
    wallcoveringAlerts.approvedNotOrdered.map((i) => wcItemBlock(i, "#d32f2f")).join(""),
  );
  html += alertSection(
    "🔴 Needs Sample Ordering",
    wallcoveringAlerts.needsOrdering.length,
    "#ffebee",
    "#d32f2f",
    "#d32f2f",
    wallcoveringAlerts.needsOrdering.map((i) => wcItemBlock(i, "#d32f2f")).join(""),
  );
  html += alertSection(
    "ℹ️ Recently Ordered",
    wallcoveringAlerts.awaitingApproval.length,
    "#e8f5e9",
    "#4caf50",
    "#4caf50",
    wallcoveringAlerts.awaitingApproval.map((i) => wcItemBlock(i, "#4caf50")).join(""),
  );
  html += alertSection(
    "🟡 Awaiting Approval",
    wallcoveringAlerts.overdueApproval.length,
    "#fff3e0",
    "#ff9800",
    "#ff9800",
    wallcoveringAlerts.overdueApproval.map((i) => wcItemBlock(i, "#ff9800")).join(""),
  );
  html += alertSection(
    "📅 Upcoming Installations (Next 7 Days)",
    wallcoveringAlerts.upcomingInstalls.length,
    "#f3e5f5",
    "#9c27b0",
    "#9c27b0",
    wallcoveringAlerts.upcomingInstalls.map((i) => wcItemBlock(i, "#9c27b0")).join(""),
  );

  html += `<tr><td style="padding: 20px 20px 10px 20px;"><h2 style="margin: 0; font-size: 22px; color: #3a4d5c; border-bottom: 2px solid #3a4d5c; padding-bottom: 8px;">Paint Tracker</h2></td></tr>`;

  html += alertSection(
    "⚠️ Needs Revision",
    paintAlerts.needsRevision.length,
    "#fff8e1",
    "#f57c00",
    "#f57c00",
    paintAlerts.needsRevision.map((i) => paintItemBlock(i, "#f57c00")).join(""),
  );
  html += alertSection(
    "🔴 Needs Submittal Ordering",
    paintAlerts.needsOrdering.length,
    "#ffebee",
    "#d32f2f",
    "#d32f2f",
    paintAlerts.needsOrdering.map((i) => paintItemBlock(i, "#d32f2f")).join(""),
  );
  html += alertSection(
    "ℹ️ Recently Ordered",
    paintAlerts.awaitingApproval.length,
    "#e8f5e9",
    "#4caf50",
    "#4caf50",
    paintAlerts.awaitingApproval.map((i) => paintItemBlock(i, "#4caf50")).join(""),
  );
  html += alertSection(
    "🟡 Awaiting Approval",
    paintAlerts.overdueApproval.length,
    "#fff3e0",
    "#ff9800",
    "#ff9800",
    paintAlerts.overdueApproval.map((i) => paintItemBlock(i, "#ff9800")).join(""),
  );
  html += alertSection(
    "📅 Upcoming Start Dates (Next 7 Days)",
    paintAlerts.upcomingStarts.length,
    "#f3e5f5",
    "#9c27b0",
    "#9c27b0",
    paintAlerts.upcomingStarts
      .map((i) =>
        paintItemBlock(
          i,
          "#9c27b0",
          i.startDate
            ? `<p style="margin: 0; font-size: 13px; color: #9c27b0; font-weight: bold;">Start Date: ${escHtml(i.startDate)} (${i.daysUntil} days)</p>`
            : "",
        ),
      )
      .join(""),
  );

  if (
    totalIssues === 0 &&
    wallcoveringAlerts.upcomingInstalls.length === 0 &&
    paintAlerts.upcomingStarts.length === 0
  ) {
    html += `<tr><td style="padding: 40px 20px; text-align: center;">
                    <h2 style="margin: 0 0 10px 0; font-size: 24px; color: #4caf50;">✅ All Clear!</h2>
                    <p style="margin: 0; font-size: 15px; color: #666;">No submittals need attention this week.</p>
                  </td></tr>`;
  }

  html += digestFooter(companyName, companyAddress);
  html += `</table></td></tr></table></body></html>`;
  return html;
}

export function buildWallcoveringWeeklyDigestHtml(
  alerts: WallcoveringDigestAlerts,
  branding: TrackerNotificationBranding,
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());
  const totalItems =
    alerts.needsOrdering.length +
    alerts.awaitingApproval.length +
    alerts.overdueApproval.length +
    alerts.approvedNotOrdered.length;
  const needsAttention = alerts.needsOrdering.length + alerts.approvedNotOrdered.length;

  let html = `<html>
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
                <tr>
                  <td style="background-color: #3a4d5c; padding: 25px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: bold;">Weekly Wallcovering Status</h1>
                    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${today}</p>
                  </td>
                </tr>
                <tr><td style="padding: 0; background-color: #d4e6f1;">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-bottom: 3px solid #3a4d5c;">
                      <tr>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:24px;font-weight:bold;color:#3a4d5c;">${totalItems}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Tracked items</p></td>
                        <td width="50%" style="text-align: center;"><p style="margin:0;font-size:24px;font-weight:bold;color:#d32f2f;">${needsAttention}</p><p style="margin:3px 0 0;font-size:11px;color:#3a4d5c;text-transform:uppercase;font-weight:600;">Needs attention</p></td>
                      </tr>
                    </table>
                  </td></tr>`;

  html += alertSection(
    "⚠️ Approved — Material Not Yet Ordered",
    alerts.approvedNotOrdered.length,
    "#fff3e0",
    "#ff6f00",
    "#ff6f00",
    alerts.approvedNotOrdered.map((i) => wcItemBlock(i, "#ff6f00")).join(""),
  );
  html += alertSection(
    "🔴 Needs Sample Ordering",
    alerts.needsOrdering.length,
    "#ffebee",
    "#d32f2f",
    "#d32f2f",
    alerts.needsOrdering.map((i) => wcItemBlock(i, "#d32f2f")).join(""),
  );
  html += alertSection(
    "ℹ️ Recently Ordered",
    alerts.awaitingApproval.length,
    "#e8f5e9",
    "#4caf50",
    "#4caf50",
    alerts.awaitingApproval.map((i) => wcItemBlock(i, "#4caf50")).join(""),
  );
  html += alertSection(
    "🟡 Awaiting Approval",
    alerts.overdueApproval.length,
    "#fff3e0",
    "#ff9800",
    "#ff9800",
    alerts.overdueApproval.map((i) => wcItemBlock(i, "#ff9800")).join(""),
  );
  html += alertSection(
    "📅 Upcoming Installations (Next 7 Days)",
    alerts.upcomingInstalls.length,
    "#f3e5f5",
    "#9c27b0",
    "#9c27b0",
    alerts.upcomingInstalls.map((i) => wcItemBlock(i, "#9c27b0")).join(""),
  );

  if (totalItems === 0 && alerts.upcomingInstalls.length === 0) {
    html += `<tr><td style="padding: 40px 20px; text-align: center;">
                    <h2 style="margin: 0 0 10px 0; font-size: 24px; color: #4caf50;">✅ All Clear!</h2>
                    <p style="margin: 0; font-size: 15px; color: #666;">No wallcovering items need attention.</p>
                  </td></tr>`;
  }

  html += digestFooter(companyName, companyAddress);
  html += `</table></td></tr></table></body></html>`;
  return html;
}

export type WeeklyDigestKind = "combined" | "wallcovering";

export async function sendWeeklyTrackerDigest(options: {
  kind: WeeklyDigestKind;
  projects: ProjectForm[];
  primaryEmail: string;
  primaryName: string;
  superEmails: SuperEmail[];
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  gasPost?: GasEmailPost;
}): Promise<void> {
  const recipients = resolveTrackerNotificationRecipients(
    options.primaryEmail,
    options.superEmails,
    collectProjectForemanCc(options.projects),
  );
  if (!recipients) {
    throw new Error("Set a notification primary email in Settings → Paint & email.");
  }

  const branding: TrackerNotificationBranding = {
    companyName: options.companyName,
    companyAddress: options.companyAddress,
    primaryName: options.primaryName,
  };

  const wcAlerts = collectWallcoveringDigestAlerts(options.projects);
  const paintAlerts = collectPaintDigestAlerts(options.projects);

  const subject =
    options.kind === "combined"
      ? `Weekly Submittal Status — ${formatTodayLong()}`
      : `Weekly Wallcovering Status — ${formatTodayLong()}`;

  const html =
    options.kind === "combined"
      ? buildCombinedWeeklyDigestHtml(wcAlerts, paintAlerts, branding)
      : buildWallcoveringWeeklyDigestHtml(wcAlerts, branding);

  const htmlForSend = await embedLogoUrlInHtml(html, options.logoUrl ?? "");

  const payload: SendVendorEmailRequest = {
    to: recipients.to,
    cc: recipients.cc,
    subject,
    html: htmlForSend,
    text: "Weekly tracker digest — open in an HTML-capable email client.",
    from_name: options.fromName,
  };

  if (options.gasPost) {
    await options.gasPost(options.gasUrl, payload);
    return;
  }

  await sendVendorEmail(payload, { gasUrl: options.gasUrl });
}

export async function sendWeeklyTrackerDigestViaGasDirect(
  options: Omit<Parameters<typeof sendWeeklyTrackerDigest>[0], "gasPost">,
): Promise<void> {
  return sendWeeklyTrackerDigest({ ...options, gasPost: sendVendorEmailGasDirect });
}

export async function loadProjectsForWeeklyDigest(): Promise<{
  projects: ProjectForm[];
  error: string | null;
}> {
  return loadAllProjectsForField();
}
