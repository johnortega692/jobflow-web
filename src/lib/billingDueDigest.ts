import type { ProjectForm } from "../types/database.js";
import {
  billingDueDayLabel,
  icbiPmEmail,
  icbiProjectManager,
  jobFullAddressOneLine,
  normalizeBillingDueDay,
} from "./jobInfo.js";
import { embedLogoUrlInHtml } from "./emailImageEmbed.js";
import { type TrackerNotificationBranding } from "./trackerNotificationEmail.js";
import { sendVendorEmailAsOrderEmailDirect } from "./sendOrderEmailGasDirect.js";
import type { SendVendorEmailRequest } from "./sendVendorEmail.js";
import type { GasEmailPost } from "./sendVendorEmailGasDirect.js";
import { loadAllProjectsForField } from "./fieldTrackerProject.js";
import { loadVisibleProjectsForTrackerEmails } from "./projectFieldAppVisibility.js";

/** Days before Billing Due day to email the ICBI PM. */
export const BILLING_DUE_REMINDER_DAYS_BEFORE = 4;

export type BillingDueProjectAlert = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  address: string;
  contractor: string;
  billingDueDay: string;
  billingDueLabel: string;
  dueDateDisplay: string;
  daysUntilDue: number;
  pmName: string;
  pmEmail: string;
};

type BillingDuePmGroup = {
  email: string;
  name: string;
  alerts: BillingDueProjectAlert[];
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTodayLong(today = new Date()): string {
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function formatDueDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Effective due date in a calendar month (29–31 clamp to last day). */
export function effectiveBillingDueDate(year: number, monthIndex: number, dueDay: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(1, dueDay), lastDay);
  return startOfDay(new Date(year, monthIndex, day));
}

/**
 * True when today is exactly {@link BILLING_DUE_REMINDER_DAYS_BEFORE} days before
 * this job's billing due day (this month or next month occurrence).
 */
export function isBillingDueReminderToday(dueDayRaw: string, today = new Date()): boolean {
  const dueDay = Number(normalizeBillingDueDay(dueDayRaw));
  if (!dueDay) return false;
  const todayStart = startOfDay(today);

  for (const monthOffset of [0, 1]) {
    const y = todayStart.getFullYear();
    const m = todayStart.getMonth() + monthOffset;
    const due = effectiveBillingDueDate(y, m, dueDay);
    const remind = startOfDay(new Date(due));
    remind.setDate(remind.getDate() - BILLING_DUE_REMINDER_DAYS_BEFORE);
    if (sameCalendarDay(remind, todayStart)) return true;
  }
  return false;
}

function upcomingDueDateForReminder(dueDay: number, today: Date): Date {
  const todayStart = startOfDay(today);
  for (const monthOffset of [0, 1]) {
    const due = effectiveBillingDueDate(
      todayStart.getFullYear(),
      todayStart.getMonth() + monthOffset,
      dueDay,
    );
    const remind = startOfDay(new Date(due));
    remind.setDate(remind.getDate() - BILLING_DUE_REMINDER_DAYS_BEFORE);
    if (sameCalendarDay(remind, todayStart)) return due;
  }
  return effectiveBillingDueDate(todayStart.getFullYear(), todayStart.getMonth(), dueDay);
}

/** Jobs whose billing due day is exactly 4 days from today. */
export function collectBillingDueAlerts(
  projects: ProjectForm[],
  today = new Date(),
): BillingDueProjectAlert[] {
  const alerts: BillingDueProjectAlert[] = [];

  for (const project of projects) {
    const day = normalizeBillingDueDay(project.jobInfo.billing_due_day);
    if (!day || !isBillingDueReminderToday(day, today)) continue;
    const label = billingDueDayLabel(day);
    if (!label) continue;
    const dueDayNum = Number(day);
    const dueDate = upcomingDueDateForReminder(dueDayNum, today);

    alerts.push({
      projectId: project.id,
      jobNumber: project.job_number.trim(),
      jobName: project.job_name.trim(),
      address: jobFullAddressOneLine(project, project.jobInfo),
      contractor: project.contractor.trim(),
      billingDueDay: day,
      billingDueLabel: label,
      dueDateDisplay: formatDueDateLong(dueDate),
      daysUntilDue: BILLING_DUE_REMINDER_DAYS_BEFORE,
      pmName: icbiProjectManager(project.jobInfo),
      pmEmail: icbiPmEmail(project.jobInfo),
    });
  }

  alerts.sort((a, b) => {
    const dayCmp = Number(a.billingDueDay) - Number(b.billingDueDay);
    if (dayCmp !== 0) return dayCmp;
    return a.jobNumber.localeCompare(b.jobNumber) || a.jobName.localeCompare(b.jobName);
  });

  return alerts;
}

/** Group alerts by ICBI PM email — billing digest is PM-only (no office / super CC). */
export function groupBillingDueAlertsByIcbiPm(alerts: BillingDueProjectAlert[]): BillingDuePmGroup[] {
  const byEmail = new Map<string, BillingDuePmGroup>();

  for (const alert of alerts) {
    const email = alert.pmEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.alerts.push(alert);
      if (!existing.name.trim() && alert.pmName.trim()) existing.name = alert.pmName.trim();
    } else {
      byEmail.set(email, {
        email: alert.pmEmail.trim(),
        name: alert.pmName.trim() || "PM",
        alerts: [alert],
      });
    }
  }

  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export function billingDueDigestHasContent(projects: ProjectForm[], today = new Date()): boolean {
  return groupBillingDueAlertsByIcbiPm(collectBillingDueAlerts(projects, today)).length > 0;
}

function projectBlock(alert: BillingDueProjectAlert): string {
  const job = `${alert.jobNumber} ${alert.jobName}`.trim() || "Project";
  const gc = alert.contractor
    ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #666;"><strong>GC:</strong> ${escHtml(alert.contractor)}</p>`
    : "";
  return `<div style="margin: 0 0 12px 0; padding: 12px 14px; background: #ffffff; border-left: 4px solid #c62828; border-radius: 4px;">
    <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: bold; color: #222;">${escHtml(job)}</p>
    <p style="margin: 0 0 4px 0; font-size: 13px; color: #666;">${escHtml(alert.address || "Address TBD")}</p>
    ${gc}
    <p style="margin: 0; font-size: 13px; color: #8a6d00;"><strong>Billing due:</strong> ${escHtml(alert.dueDateDisplay)} (${escHtml(alert.billingDueLabel)} of each month)</p>
    <p style="margin: 6px 0 0; font-size: 13px; color: #c62828;"><strong>${alert.daysUntilDue} days</strong> until billing due</p>
  </div>`;
}

export function buildBillingDueDigestHtml(
  alerts: BillingDueProjectAlert[],
  branding: TrackerNotificationBranding,
  today = new Date(),
): string {
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const todayLabel = escHtml(formatTodayLong(today));

  let html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:20px 0;">
      <tr><td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:20px 24px;background:#6b5310;">
            <p style="margin:0;font-size:12px;color:#ffe9a8;">${escHtml(companyName)} · Billing due</p>
            <h1 style="margin:6px 0 0;font-size:22px;color:#ffffff;">Billing due in ${BILLING_DUE_REMINDER_DAYS_BEFORE} days</h1>
            <p style="margin:8px 0 0;font-size:13px;color:#ffe9a8;">${todayLabel}</p>
          </td></tr>
          <tr><td style="padding:18px 24px 8px 24px;">
            <p style="margin:0;font-size:14px;color:#333;">Hi ${primaryName},</p>
            <p style="margin:10px 0 0;font-size:14px;color:#555;">
              These jobs have billing due in <strong>${BILLING_DUE_REMINDER_DAYS_BEFORE} days</strong>
              (Job info Billing Due day). This email goes to the ICBI PM only.
            </p>
          </td></tr>`;

  if (alerts.length) {
    html += `<tr><td style="padding: 16px 20px 4px 20px;">
      <div style="background: #ffebee; border: 1px solid #ef9a9a; border-radius: 8px; padding: 14px 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #c62828;">Due in ${BILLING_DUE_REMINDER_DAYS_BEFORE} days (${alerts.length})</h3>
        ${alerts.map((a) => projectBlock(a)).join("")}
      </div>
    </td></tr>`;
  } else {
    html += `<tr><td style="padding: 40px 24px; text-align: center;">
      <h2 style="margin: 0 0 8px 0; font-size: 22px; color: #2e7d32;">All clear</h2>
      <p style="margin: 0; font-size: 14px; color: #666;">No jobs are ${BILLING_DUE_REMINDER_DAYS_BEFORE} days from billing due today.</p>
    </td></tr>`;
  }

  html += `<tr><td style="padding: 16px 20px; background: #6b5310; text-align: center;">
    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff;">Automated billing due reminder from ${escHtml(companyName)} Dashboard</p>
    <p style="margin: 0; font-size: 10px; color: #ffe9a8;">${escHtml(companyAddress)}</p>
  </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  return html;
}

export async function sendBillingDueDigest(options: {
  projects: ProjectForm[];
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  gasPost?: GasEmailPost;
  today?: Date;
  /** @deprecated Unused — billing due goes to ICBI PM emails on each job. */
  primaryEmail?: string;
  /** @deprecated Unused — greeting uses each job's ICBI PM name. */
  primaryName?: string;
}): Promise<{ sent: boolean; count: number; pmCount: number; skippedNoPm: number }> {
  const today = options.today ?? new Date();
  const allAlerts = collectBillingDueAlerts(options.projects, today);
  if (!allAlerts.length) return { sent: false, count: 0, pmCount: 0, skippedNoPm: 0 };

  const groups = groupBillingDueAlertsByIcbiPm(allAlerts);
  const skippedNoPm = allAlerts.length - groups.reduce((n, g) => n + g.alerts.length, 0);
  if (!groups.length) {
    throw new Error(
      "No ICBI PM emails on jobs in the billing reminder window. Set PM email in Job setup → ICBI Info.",
    );
  }

  let jobCount = 0;
  for (const group of groups) {
    const branding: TrackerNotificationBranding = {
      companyName: options.companyName,
      companyAddress: options.companyAddress,
      primaryName: group.name,
    };

    const html = await embedLogoUrlInHtml(
      buildBillingDueDigestHtml(group.alerts, branding, today),
      options.logoUrl ?? "",
    );
    const subject = `Billing due in ${BILLING_DUE_REMINDER_DAYS_BEFORE} days (${group.alerts.length} job${group.alerts.length === 1 ? "" : "s"})`;

    const payload: SendVendorEmailRequest = {
      to: [group.email],
      cc: [],
      subject,
      html,
      text: "Billing due reminder — open in an HTML-capable email client.",
      from_name: options.fromName,
    };

    if (options.gasPost) {
      await options.gasPost(options.gasUrl, payload);
    } else {
      await sendVendorEmailAsOrderEmailDirect(options.gasUrl, payload);
    }
    jobCount += group.alerts.length;
  }

  return { sent: true, count: jobCount, pmCount: groups.length, skippedNoPm };
}

export async function sendBillingDueDigestViaGasDirect(
  options: Omit<Parameters<typeof sendBillingDueDigest>[0], "gasPost">,
): Promise<{ sent: boolean; count: number; pmCount: number; skippedNoPm: number }> {
  return sendBillingDueDigest({ ...options, gasPost: sendVendorEmailAsOrderEmailDirect });
}

export async function loadProjectsForBillingDueDigest(): Promise<{
  projects: ProjectForm[];
  error: string | null;
}> {
  return loadVisibleProjectsForTrackerEmails(loadAllProjectsForField);
}
