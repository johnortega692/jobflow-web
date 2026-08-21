import type { ProjectForm } from "../types/database";
import {
  billingDueDayLabel,
  collectProjectIcbiStaffCc,
  jobFullAddressOneLine,
  normalizeBillingDueDay,
} from "./jobInfo";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import {
  resolveTrackerNotificationRecipients,
  type TrackerNotificationBranding,
} from "./trackerNotificationEmail";
import { sendVendorEmail, type SendVendorEmailRequest } from "./sendVendorEmail";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";
import { loadAllProjectsForField } from "./fieldTrackerProject";

export type BillingDueProjectAlert = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  address: string;
  contractor: string;
  billingDueDay: string;
  billingDueLabel: string;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTodayLong(today = new Date()): string {
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

/** True when this project's billing day matches today (last day of short months covers 29–31). */
export function isBillingDueToday(dueDayRaw: string, today = new Date()): boolean {
  const dueDay = Number(normalizeBillingDueDay(dueDayRaw));
  if (!dueDay) return false;
  const dayOfMonth = today.getDate();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  if (dueDay === dayOfMonth) return true;
  return dueDay > lastDay && dayOfMonth === lastDay;
}

export function collectBillingDueAlerts(
  projects: ProjectForm[],
  today = new Date(),
): BillingDueProjectAlert[] {
  const alerts: BillingDueProjectAlert[] = [];

  for (const project of projects) {
    const day = normalizeBillingDueDay(project.jobInfo.billing_due_day);
    if (!day || !isBillingDueToday(day, today)) continue;
    const label = billingDueDayLabel(day);
    if (!label) continue;

    alerts.push({
      projectId: project.id,
      jobNumber: project.job_number.trim(),
      jobName: project.job_name.trim(),
      address: jobFullAddressOneLine(project, project.jobInfo),
      contractor: project.contractor.trim(),
      billingDueDay: day,
      billingDueLabel: label,
    });
  }

  alerts.sort((a, b) => {
    const dayCmp = Number(a.billingDueDay) - Number(b.billingDueDay);
    if (dayCmp !== 0) return dayCmp;
    return a.jobNumber.localeCompare(b.jobNumber) || a.jobName.localeCompare(b.jobName);
  });

  return alerts;
}

export function billingDueDigestHasContent(projects: ProjectForm[], today = new Date()): boolean {
  return collectBillingDueAlerts(projects, today).length > 0;
}

function projectBlock(alert: BillingDueProjectAlert): string {
  const job = `${alert.jobNumber} ${alert.jobName}`.trim() || "Project";
  const gc = alert.contractor ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #666;"><strong>GC:</strong> ${escHtml(alert.contractor)}</p>` : "";
  return `<div style="margin: 0 0 12px 0; padding: 12px 14px; background: #ffffff; border-left: 4px solid #f0b429; border-radius: 4px;">
    <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: bold; color: #222;">${escHtml(job)}</p>
    <p style="margin: 0 0 4px 0; font-size: 13px; color: #666;">${escHtml(alert.address || "Address TBD")}</p>
    ${gc}
    <p style="margin: 0; font-size: 13px; color: #8a6d00;"><strong>Billing due:</strong> ${escHtml(alert.billingDueLabel)} of each month</p>
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
  const dayLabel = escHtml(billingDueDayLabel(String(today.getDate())) || String(today.getDate()));

  let html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:20px 0;">
      <tr><td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:20px 24px;background:#6b5310;">
            <p style="margin:0;font-size:12px;color:#ffe9a8;">${escHtml(companyName)} · Billing due</p>
            <h1 style="margin:6px 0 0;font-size:22px;color:#ffffff;">Billing due today</h1>
            <p style="margin:8px 0 0;font-size:13px;color:#ffe9a8;">${todayLabel} · ${dayLabel}</p>
          </td></tr>
          <tr><td style="padding:18px 24px 8px 24px;">
            <p style="margin:0;font-size:14px;color:#333;">Hi ${primaryName},</p>
            <p style="margin:10px 0 0;font-size:14px;color:#555;">
              These jobs have <strong>Billing Due</strong> set for today&apos;s day of the month.
              This is a separate billing reminder (not the weekly submittal digest).
            </p>
          </td></tr>`;

  if (alerts.length) {
    html += `<tr><td style="padding: 16px 20px 4px 20px;">
      <div style="background: #fff8e1; border: 1px solid #ffe082; border-radius: 8px; padding: 14px 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #8a6d00;">Due today (${alerts.length})</h3>
        ${alerts.map((a) => projectBlock(a)).join("")}
      </div>
    </td></tr>`;
  } else {
    html += `<tr><td style="padding: 40px 24px; text-align: center;">
      <h2 style="margin: 0 0 8px 0; font-size: 22px; color: #2e7d32;">All clear</h2>
      <p style="margin: 0; font-size: 14px; color: #666;">No jobs have billing due today.</p>
    </td></tr>`;
  }

  html += `<tr><td style="padding: 16px 20px; background: #6b5310; text-align: center;">
    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff;">Automated billing due email from ${escHtml(companyName)} Dashboard</p>
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
  primaryEmail: string;
  primaryName: string;
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  gasPost?: GasEmailPost;
  today?: Date;
}): Promise<{ sent: boolean; count: number }> {
  const today = options.today ?? new Date();
  const alerts = collectBillingDueAlerts(options.projects, today);
  if (!alerts.length) return { sent: false, count: 0 };

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
    buildBillingDueDigestHtml(alerts, branding, today),
    options.logoUrl ?? "",
  );
  const subject = `Billing due — ${formatTodayLong(today)} (${alerts.length} job${alerts.length === 1 ? "" : "s"})`;

  const payload: SendVendorEmailRequest = {
    to: recipients.to,
    cc: recipients.cc,
    subject,
    html,
    text: "Billing due digest — open in an HTML-capable email client.",
    from_name: options.fromName,
  };

  if (options.gasPost) {
    await options.gasPost(options.gasUrl, payload);
  } else {
    await sendVendorEmail(payload, { gasUrl: options.gasUrl });
  }

  return { sent: true, count: alerts.length };
}

export async function sendBillingDueDigestViaGasDirect(
  options: Omit<Parameters<typeof sendBillingDueDigest>[0], "gasPost">,
): Promise<{ sent: boolean; count: number }> {
  return sendBillingDueDigest({ ...options, gasPost: sendVendorEmailGasDirect });
}

export async function loadProjectsForBillingDueDigest(): Promise<{
  projects: ProjectForm[];
  error: string | null;
}> {
  return loadAllProjectsForField();
}
