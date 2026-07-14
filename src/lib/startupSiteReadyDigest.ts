import type { ProjectForm } from "../types/database";
import { collectProjectIcbiStaffCc, jobFullAddressOneLine } from "./jobInfo";
import { parseFlexibleDate } from "./dateInputUtils";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import {
  itemNeedsAttention,
  parseDashboardStartupItems,
  PRELIM_NOTICE_ITEM_ID,
  shortAttentionLabel,
  type StartupChecklistGroup,
  type StartupChecklistItem,
} from "./projectStartupItems";
import {
  resolveTrackerNotificationRecipients,
  type TrackerNotificationBranding,
} from "./trackerNotificationEmail";
import { sendVendorEmail, type SendVendorEmailRequest } from "./sendVendorEmail";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";

/** Gate items that must be done before manpower belongs on site. */
export const SITE_READY_GATE_ITEM_IDS = ["executed_subcontract", "coi_sent"] as const;

/** Other Needs attention stays focused on these startup groups. */
const OTHER_ATTENTION_GROUPS: StartupChecklistGroup[] = [
  "contract_compliance",
  "procurement_field",
  "billing",
];

/** Include in weekly snapshot when start is within this many days (or already past). */
export const SITE_READY_SNAPSHOT_DAYS = 14;

/** Urgent escalation band inside the weekly email. */
export const SITE_READY_ESCALATION_DAYS = 7;

export type SiteReadyMissingItem = {
  id: string;
  label: string;
};

export type SiteReadyProjectAlert = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  address: string;
  startDateDisplay: string;
  daysUntilStart: number | null;
  missing: SiteReadyMissingItem[];
  /** Start within escalation window or already overdue/past. */
  escalated: boolean;
  /** Start date missing while gate items still open. */
  missingStartDate: boolean;
};

export type OtherAttentionProjectAlert = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  address: string;
  startDateDisplay: string;
  items: SiteReadyMissingItem[];
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntilStartDate(raw: string): number | null {
  const parsed = parseFlexibleDate(raw.trim());
  if (!parsed) return null;
  const today = startOfDay(new Date());
  const target = startOfDay(parsed);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatStartDisplay(raw: string): string {
  const parsed = parseFlexibleDate(raw.trim());
  if (!parsed) return raw.trim();
  return parsed.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function isGateItemId(id: string): boolean {
  return SITE_READY_GATE_ITEM_IDS.includes(id as (typeof SITE_READY_GATE_ITEM_IDS)[number]);
}

function incompleteGateItems(items: StartupChecklistItem[]): SiteReadyMissingItem[] {
  return items
    .filter((item) => isGateItemId(item.id) && item.enabled && !item.complete)
    .map((item) => ({ id: item.id, label: item.label }));
}

function otherAttentionItems(
  items: StartupChecklistItem[],
  jobInfo: ProjectForm["jobInfo"],
): SiteReadyMissingItem[] {
  return items
    .filter((item) => {
      if (isGateItemId(item.id)) return false;
      if (!OTHER_ATTENTION_GROUPS.includes(item.group)) return false;
      if (!itemNeedsAttention(item, jobInfo)) return false;
      return item.blocking || item.id === PRELIM_NOTICE_ITEM_ID;
    })
    .map((item) => ({
      id: item.id,
      label: shortAttentionLabel(item, jobInfo),
    }));
}

/**
 * Projects where Return executed contract and/or Send COI are still open,
 * and start date is within the snapshot window (or already past / missing).
 */
export function collectSiteReadyAlerts(projects: ProjectForm[]): SiteReadyProjectAlert[] {
  const alerts: SiteReadyProjectAlert[] = [];

  for (const project of projects) {
    const startup = parseDashboardStartupItems(project);
    const missing = incompleteGateItems(startup.items);
    if (!missing.length) continue;

    const startRaw = project.jobInfo.start_date.trim();
    const daysUntil = startRaw ? daysUntilStartDate(startRaw) : null;
    const missingStartDate = !startRaw || daysUntil === null;

    if (!missingStartDate && daysUntil! > SITE_READY_SNAPSHOT_DAYS) {
      continue;
    }

    const escalated = !missingStartDate && daysUntil! <= SITE_READY_ESCALATION_DAYS;

    alerts.push({
      projectId: project.id,
      jobNumber: project.job_number.trim(),
      jobName: project.job_name.trim(),
      address: jobFullAddressOneLine(project, project.jobInfo),
      startDateDisplay: missingStartDate ? "—" : formatStartDisplay(startRaw),
      daysUntilStart: daysUntil,
      missing,
      escalated,
      missingStartDate,
    });
  }

  alerts.sort((a, b) => {
    if (a.missingStartDate !== b.missingStartDate) return a.missingStartDate ? 1 : -1;
    const ad = a.daysUntilStart ?? 9999;
    const bd = b.daysUntilStart ?? 9999;
    if (ad !== bd) return ad - bd;
    return a.jobNumber.localeCompare(b.jobNumber);
  });

  return alerts;
}

/** Outstanding blocking Contract / Procurement / Billing (plus prelim), excluding the two site gates. */
export function collectOtherAttentionAlerts(projects: ProjectForm[]): OtherAttentionProjectAlert[] {
  const alerts: OtherAttentionProjectAlert[] = [];

  for (const project of projects) {
    const startup = parseDashboardStartupItems(project);
    const items = otherAttentionItems(startup.items, project.jobInfo);
    if (!items.length) continue;

    const startRaw = project.jobInfo.start_date.trim();
    const daysUntil = startRaw ? daysUntilStartDate(startRaw) : null;
    const missingStartDate = !startRaw || daysUntil === null;

    alerts.push({
      projectId: project.id,
      jobNumber: project.job_number.trim(),
      jobName: project.job_name.trim(),
      address: jobFullAddressOneLine(project, project.jobInfo),
      startDateDisplay: missingStartDate ? "—" : formatStartDisplay(startRaw),
      items,
    });
  }

  alerts.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber) || a.jobName.localeCompare(b.jobName));
  return alerts;
}

export function siteReadyDigestHasContent(projects: ProjectForm[]): boolean {
  return collectSiteReadyAlerts(projects).length > 0 || collectOtherAttentionAlerts(projects).length > 0;
}

function timingLabel(alert: SiteReadyProjectAlert): string {
  if (alert.missingStartDate) return "Start date not set";
  const d = alert.daysUntilStart!;
  if (d < 0) return `Started ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
  if (d === 0) return "Starts today";
  return `${d} day${d === 1 ? "" : "s"} until start`;
}

function projectBlock(alert: SiteReadyProjectAlert, accent: string): string {
  const job = `${alert.jobNumber} ${alert.jobName}`.trim() || "Project";
  const missingList = alert.missing.map((m) => escHtml(m.label)).join("; ");
  return `<div style="margin: 0 0 12px 0; padding: 12px 14px; background: #ffffff; border-left: 4px solid ${accent}; border-radius: 4px;">
    <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: bold; color: #222;">${escHtml(job)}</p>
    <p style="margin: 0 0 4px 0; font-size: 13px; color: #666;">${escHtml(alert.address || "Address TBD")}</p>
    <p style="margin: 0 0 4px 0; font-size: 13px; color: #666;"><strong>Start:</strong> ${escHtml(alert.startDateDisplay)} · ${escHtml(timingLabel(alert))}</p>
    <p style="margin: 0; font-size: 13px; color: #b71c1c;"><strong>Missing:</strong> ${missingList}</p>
  </div>`;
}

function otherAttentionBlock(alert: OtherAttentionProjectAlert): string {
  const job = `${alert.jobNumber} ${alert.jobName}`.trim() || "Project";
  const list = alert.items.map((m) => `<li style="margin: 0 0 4px 0;">${escHtml(m.label)}</li>`).join("");
  return `<div style="margin: 0 0 12px 0; padding: 12px 14px; background: #ffffff; border-left: 4px solid #5c6bc0; border-radius: 4px;">
    <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: bold; color: #222;">${escHtml(job)}</p>
    <p style="margin: 0 0 6px 0; font-size: 13px; color: #666;">${escHtml(alert.address || "Address TBD")} · Start: ${escHtml(alert.startDateDisplay)}</p>
    <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #333;">${list}</ul>
  </div>`;
}

function section(
  title: string,
  count: number,
  bg: string,
  border: string,
  accent: string,
  bodyHtml: string,
): string {
  if (!count) return "";
  return `<tr><td style="padding: 16px 20px 4px 20px;">
    <div style="background: ${bg}; border: 1px solid ${border}; border-radius: 8px; padding: 14px 16px;">
      <h3 style="margin: 0 0 12px 0; font-size: 16px; color: ${accent};">${escHtml(title)} (${count})</h3>
      ${bodyHtml}
    </div>
  </td></tr>`;
}

export function buildSiteReadyDigestHtml(
  alerts: SiteReadyProjectAlert[],
  branding: TrackerNotificationBranding,
  otherAttention: OtherAttentionProjectAlert[] = [],
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const today = escHtml(formatTodayLong());

  const escalated = alerts.filter((a) => a.escalated);
  const upcoming = alerts.filter((a) => !a.escalated && !a.missingStartDate);
  const noStart = alerts.filter((a) => a.missingStartDate);

  let html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:20px 0;">
      <tr><td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:20px 24px;background:#3a4d5c;">
            <p style="margin:0;font-size:12px;color:#b8d4e6;">${escHtml(companyName)} · Monday site-ready</p>
            <h1 style="margin:6px 0 0;font-size:22px;color:#ffffff;">Before crew should be on site</h1>
            <p style="margin:8px 0 0;font-size:13px;color:#dce7ef;">${today}</p>
          </td></tr>
          <tr><td style="padding:18px 24px 8px 24px;">
            <p style="margin:0;font-size:14px;color:#333;">Hi ${primaryName},</p>
            <p style="margin:10px 0 0;font-size:14px;color:#555;">
              Monday check for <strong>Return executed contract</strong> and <strong>Send COI</strong>
              on jobs starting within ${SITE_READY_SNAPSHOT_DAYS} days (or already started),
              plus other Contract / Procurement / Billing Needs attention for the week ahead.
            </p>
          </td></tr>`;

  html += section(
    "Urgent — start within 7 days or already started",
    escalated.length,
    "#ffebee",
    "#ef9a9a",
    "#c62828",
    escalated.map((a) => projectBlock(a, "#c62828")).join(""),
  );
  html += section(
    "Coming up — start within 14 days",
    upcoming.length,
    "#fff8e1",
    "#ffe082",
    "#f57c00",
    upcoming.map((a) => projectBlock(a, "#f57c00")).join(""),
  );
  html += section(
    "Missing start date — still open",
    noStart.length,
    "#eceff1",
    "#b0bec5",
    "#546e7a",
    noStart.map((a) => projectBlock(a, "#546e7a")).join(""),
  );
  html += section(
    "Other Needs attention — Contract / Procurement / Billing",
    otherAttention.length,
    "#e8eaf6",
    "#9fa8da",
    "#3949ab",
    otherAttention.map((a) => otherAttentionBlock(a)).join(""),
  );

  if (!alerts.length && !otherAttention.length) {
    html += `<tr><td style="padding: 40px 24px; text-align: center;">
      <h2 style="margin: 0 0 8px 0; font-size: 22px; color: #2e7d32;">All clear</h2>
      <p style="margin: 0; font-size: 14px; color: #666;">No site-ready or Needs attention items this week.</p>
    </td></tr>`;
  }

  html += `<tr><td style="padding: 16px 20px; background: #3a4d5c; text-align: center;">
    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff;">Automated Monday digest from ${escHtml(companyName)} Dashboard</p>
    <p style="margin: 0; font-size: 10px; color: #b8d4e6;">${escHtml(companyAddress)}</p>
  </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  return html;
}

export async function sendSiteReadyDigest(options: {
  projects: ProjectForm[];
  primaryEmail: string;
  primaryName: string;
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  gasPost?: GasEmailPost;
}): Promise<{ sent: boolean; count: number }> {
  const alerts = collectSiteReadyAlerts(options.projects);
  const otherAttention = collectOtherAttentionAlerts(options.projects);
  if (!alerts.length && !otherAttention.length) return { sent: false, count: 0 };

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

  const html = await embedLogoUrlInHtml(
    buildSiteReadyDigestHtml(alerts, branding, otherAttention),
    options.logoUrl ?? "",
  );
  const totalJobs = new Set([
    ...alerts.map((a) => a.projectId),
    ...otherAttention.map((a) => a.projectId),
  ]).size;
  const subject = `Monday site-ready — ${formatTodayLong()} (${totalJobs} job${totalJobs === 1 ? "" : "s"})`;

  const payload: SendVendorEmailRequest = {
    to: recipients.to,
    cc: recipients.cc,
    subject,
    html,
    text: "Monday site-ready digest — open in an HTML-capable email client.",
    from_name: options.fromName,
  };

  if (options.gasPost) {
    await options.gasPost(options.gasUrl, payload);
  } else {
    await sendVendorEmail(payload, { gasUrl: options.gasUrl });
  }

  return { sent: true, count: totalJobs };
}

export async function sendSiteReadyDigestViaGasDirect(
  options: Omit<Parameters<typeof sendSiteReadyDigest>[0], "gasPost">,
): Promise<{ sent: boolean; count: number }> {
  return sendSiteReadyDigest({ ...options, gasPost: sendVendorEmailGasDirect });
}
