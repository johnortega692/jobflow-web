import type { ProjectForm } from "../types/database.js";
import type { WcTrackerLineState } from "../types/fieldTracker.js";
import { projectHasWallcovering } from "./jobInfo.js";
import { buildFieldWcRows } from "./fieldTrackerProject.js";
import type { TrackerNotificationBranding } from "./trackerNotificationEmail.js";
import { fieldViewWallcoveringUrl } from "./jobflowPublicUrl.js";

const FOLLOW_UP_INSTALL_DAYS = 30;
const SHIP_NEAR_INSTALL_DAYS = 5;
const LATE_INSTALL_DAYS = 14;
const NO_DATE_APPROVAL_DAYS = 14;
const DATE_WARN_DAYS = 14;
const DATE_SOON_DAYS = 30;

export type WcSnapshotChipTone = "delivered" | "shipped" | "on_track" | "follow_up" | "late";

export type WcSnapshotChip = {
  label: string;
  tone: WcSnapshotChipTone;
};

export type WcSnapshotJob = {
  jobNumber: string;
  jobName: string;
  installDate: Date | null;
  installLabel: string;
  daysUntil: number | null;
  chips: WcSnapshotChip[];
  deliveredCount: number;
  itemCount: number;
  missingInstallCount: number;
};

const THEME = {
  header: "#3a4d5c",
  headerMuted: "#cbd5e1",
  summaryBg: "#d4e6f1",
  pageBg: "#f4f4f4",
  rowAlt: "#f8fafc",
  border: "#d1d5db",
  rowBorder: "#e5e7eb",
  text: "#333333",
  muted: "#666666",
  job: "#1a73e8",
  footerMuted: "#b8d4e6",
};

const CHIP_STYLE: Record<WcSnapshotChipTone, { bg: string; color: string; border: string }> = {
  delivered: { bg: "#4caf50", color: "#ffffff", border: "#4caf50" },
  shipped: { bg: "#1565c0", color: "#ffffff", border: "#1565c0" },
  on_track: { bg: "#ffffff", color: "#3a4d5c", border: "#3a4d5c" },
  follow_up: { bg: "#ff9800", color: "#ffffff", border: "#ff9800" },
  late: { bg: "#d32f2f", color: "#ffffff", border: "#d32f2f" },
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

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? `${trimmed.slice(0, 10)}T12:00:00` : trimmed;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

function leadTimeDays(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const rangeWeeks = t.match(/(\d+)\s*-\s*(\d+)\s*weeks?/);
  if (rangeWeeks) return Number(rangeWeeks[2]) * 7;
  const weeks = t.match(/(\d+)\s*weeks?/);
  if (weeks) return Number(weeks[1]) * 7;
  const days = t.match(/(\d+)\s*days?/);
  if (days) return Number(days[1]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chipLabel(line: WcTrackerLineState): string {
  const label = line.label.trim();
  if (label) return label.length > 8 ? label.slice(0, 8) : label;
  const name = line.wallcoveringName.trim();
  return name ? name.slice(0, 8) : "WC";
}

function isInternalTracking(line: WcTrackerLineState): boolean {
  return line.wallcoveringName.trim() === "APS Track and Infill";
}

function approvalPendingDays(line: WcTrackerLineState, today: Date): number | null {
  const fromFollowUp = parseDate(line.followUp);
  if (fromFollowUp) return daysBetween(fromFollowUp, today);
  const fromApproval = parseDate(line.approvalReceived);
  if (fromApproval) return daysBetween(fromApproval, today);
  return null;
}

export function wcSnapshotChipTone(line: WcTrackerLineState, today = new Date()): WcSnapshotChipTone {
  if (line.delivered) return "delivered";

  const install = parseDate(line.installDate);
  const ship = parseDate(line.shipDate);
  const daysUntilInstall = install ? daysBetween(today, install) : null;
  const hasInstall = daysUntilInstall !== null;
  const materialOrdered = Boolean(line.materialOrder);
  const sampleOrdered = Boolean(line.ordered);
  const leadDays = leadTimeDays(line.leadTime);

  const leadOverrunsInstall =
    hasInstall &&
    !materialOrdered &&
    leadDays != null &&
    daysUntilInstall! < leadDays;

  const lateByInstall = hasInstall && daysUntilInstall! <= LATE_INSTALL_DAYS && !line.delivered;
  const lateUnorderdSoon = lateByInstall && !materialOrdered;
  if (leadOverrunsInstall || (line.revision && !line.approved && lateByInstall) || lateUnorderdSoon) {
    return "late";
  }

  if (!hasInstall) {
    if (line.revision && !line.approved) return "follow_up";
    const pendingDays = approvalPendingDays(line, today);
    if (line.sentForApproval && !line.approved && pendingDays != null && pendingDays >= NO_DATE_APPROVAL_DAYS) {
      return "follow_up";
    }
    if (materialOrdered && ship) return "shipped";
    return "on_track";
  }

  const orderedNoShipInsideWindow =
    materialOrdered && !ship && daysUntilInstall! >= 0 && daysUntilInstall! <= FOLLOW_UP_INSTALL_DAYS;
  const shipsNearInstall =
    Boolean(ship && install) && Math.abs(daysBetween(ship!, install!)) <= SHIP_NEAR_INSTALL_DAYS;
  if (
    (line.revision && !line.approved) ||
    orderedNoShipInsideWindow ||
    shipsNearInstall ||
    (sampleOrdered && !line.approved && daysUntilInstall! <= FOLLOW_UP_INSTALL_DAYS)
  ) {
    return "follow_up";
  }

  if (materialOrdered && ship) return "shipped";
  return "on_track";
}

function formatInstallLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dateTone(daysUntil: number | null): string {
  if (daysUntil == null) return THEME.muted;
  if (daysUntil <= DATE_WARN_DAYS) return "#d32f2f";
  if (daysUntil <= DATE_SOON_DAYS) return "#ff6f00";
  return THEME.header;
}

function jobSummary(job: WcSnapshotJob): string {
  const parts: string[] = [];
  if (job.itemCount === 0) parts.push("No materials yet");
  else if (job.deliveredCount === job.itemCount) parts.push("All delivered");
  else parts.push(`${job.deliveredCount} of ${job.itemCount} delivered`);
  if (job.installDate && job.missingInstallCount > 0) {
    parts.push(`${job.missingInstallCount} need install date`);
  }
  return parts.join(" · ");
}

function summaryColor(job: WcSnapshotJob): string {
  if (job.installDate && job.missingInstallCount > 0) return "#ff6f00";
  if (job.itemCount > 0 && job.deliveredCount === job.itemCount) return "#4caf50";
  return THEME.muted;
}

export function collectWallcoveringSnapshotJobs(
  projects: ProjectForm[],
  today = new Date(),
): WcSnapshotJob[] {
  const jobs: WcSnapshotJob[] = [];

  for (const project of projects) {
    if (!projectHasWallcovering(project.jobInfo)) continue;
    const rows = buildFieldWcRows(project).filter((row) => !isInternalTracking(row.line));
    const chips: WcSnapshotChip[] = [];
    let deliveredCount = 0;
    let missingInstallCount = 0;
    let earliest: Date | null = null;

    for (const row of rows) {
      const tone = wcSnapshotChipTone(row.line, today);
      if (tone === "delivered") deliveredCount += 1;
      chips.push({ label: chipLabel(row.line), tone });
      const install = parseDate(row.line.installDate);
      if (install) {
        if (!earliest || install.getTime() < earliest.getTime()) earliest = install;
      } else {
        missingInstallCount += 1;
      }
    }

    if (rows.length === 0) missingInstallCount = 1;

    jobs.push({
      jobNumber: rows[0]?.jobNumber || project.job_number.trim() || "",
      jobName: rows[0]?.jobName || project.job_name.trim() || "",
      installDate: earliest,
      installLabel: earliest ? formatInstallLabel(earliest) : "Need install date",
      daysUntil: earliest ? daysBetween(today, earliest) : null,
      chips,
      deliveredCount,
      itemCount: chips.length,
      missingInstallCount: earliest ? missingInstallCount : Math.max(missingInstallCount, 1),
    });
  }

  jobs.sort((a, b) => {
    if (a.installDate && b.installDate) return a.installDate.getTime() - b.installDate.getTime();
    if (a.installDate) return -1;
    if (b.installDate) return 1;
    return a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true });
  });

  return jobs;
}

function chipHtml(chip: WcSnapshotChip): string {
  const style = CHIP_STYLE[chip.tone];
  return `<td style="padding: 0 4px 4px 0;">
                              <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                  <td style="background-color: ${style.bg}; border: 1px solid ${style.border}; color: ${style.color}; padding: 3px 8px; font-size: 11px; font-weight: bold; font-family: Arial, Helvetica, sans-serif; white-space: nowrap;">
                                    ${escHtml(chip.label)}
                                  </td>
                                </tr>
                              </table>
                            </td>`;
}

function legendDot(color: string, border: string, label: string): string {
  return `<td style="padding: 0 12px 6px 0; font-size: 11px; color: ${THEME.muted}; font-family: Arial, Helvetica, sans-serif; white-space: nowrap;">
                          <span style="display: inline-block; width: 8px; height: 8px; background-color: ${color}; border: 1px solid ${border}; vertical-align: middle; margin-right: 5px;"></span>${escHtml(label)}
                        </td>`;
}

function jobRowHtml(job: WcSnapshotJob, index: number): string {
  const bg = index % 2 === 0 ? "#ffffff" : THEME.rowAlt;
  const chips = job.chips.length
    ? `<table cellpadding="0" cellspacing="0" border="0"><tr>${job.chips.map(chipHtml).join("")}<td style="padding: 0 0 4px 8px; font-size: 12px; color: ${summaryColor(job)}; font-family: Arial, Helvetica, sans-serif; vertical-align: middle;">${escHtml(jobSummary(job))}</td></tr></table>`
    : `<span style="font-size: 12px; color: ${job.installDate ? THEME.muted : "#ff6f00"}; font-family: Arial, Helvetica, sans-serif;">${escHtml(job.installDate ? "No materials yet" : "Need install date")}</span>`;

  return `<tr style="background-color: ${bg};">
                              <td width="38%" style="padding: 10px; border-bottom: 1px solid ${THEME.rowBorder}; font-size: 13px; color: ${THEME.text}; vertical-align: top; font-family: Arial, Helvetica, sans-serif;">
                                <strong style="color: ${THEME.job};">${escHtml(job.jobNumber)}</strong><br>
                                <span style="color: ${THEME.text};">${escHtml(job.jobName)}</span>
                              </td>
                              <td style="padding: 10px; border-bottom: 1px solid ${THEME.rowBorder}; font-size: 13px; color: ${THEME.text}; vertical-align: top;">
                                ${chips}
                              </td>
                            </tr>`;
}

function tableHeaderHtml(): string {
  return `<tr>
                              <th align="left" width="38%" style="padding: 8px 10px; background-color: ${THEME.header}; color: #ffffff; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">Job</th>
                              <th align="left" style="padding: 8px 10px; background-color: ${THEME.header}; color: #ffffff; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">Materials</th>
                            </tr>`;
}

function wrapTable(body: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${THEME.border}; border-radius: 4px; overflow: hidden;">
                            ${tableHeaderHtml()}
                            ${body}
                          </table>`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupJobsByInstallDate(jobs: WcSnapshotJob[]): { label: string; daysUntil: number | null; jobs: WcSnapshotJob[] }[] {
  const map = new Map<string, WcSnapshotJob[]>();
  const order: string[] = [];
  for (const job of jobs) {
    if (!job.installDate) continue;
    const key = dateKey(job.installDate);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(job);
  }
  return order.map((key) => {
    const group = map.get(key)!;
    group.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }));
    return {
      label: group[0].installLabel,
      daysUntil: group[0].daysUntil,
      jobs: group,
    };
  });
}

function sectionTitle(title: string, color = THEME.header): string {
  return `<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: ${color}; font-family: Arial, Helvetica, sans-serif;">${escHtml(title)}</p>`;
}

function installDatesTableHtml(dated: WcSnapshotJob[]): string {
  if (!dated.length) return "";
  const groups = groupJobsByInstallDate(dated);
  let body = "";
  let index = 0;
  for (const group of groups) {
    const days = group.daysUntil == null ? "" : ` · ${group.daysUntil}d`;
    body += `<tr>
                              <td colspan="2" style="padding: 8px 10px; background-color: ${THEME.summaryBg}; border-bottom: 1px solid ${THEME.rowBorder}; font-size: 13px; font-weight: bold; color: ${dateTone(group.daysUntil)}; font-family: Arial, Helvetica, sans-serif;">Install date: ${escHtml(group.label)}${escHtml(days)}</td>
                            </tr>`;
    for (const job of group.jobs) {
      body += jobRowHtml(job, index);
      index += 1;
    }
  }
  return `${sectionTitle("Install dates")}
                    ${wrapTable(body)}`;
}

function needInstallDateTableHtml(undated: WcSnapshotJob[], spaced: boolean): string {
  if (!undated.length) return "";
  const countLabel = `${undated.length} job${undated.length === 1 ? "" : "s"}`;
  let body = "";
  undated.forEach((job, index) => {
    body += jobRowHtml(job, index);
  });
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="${spaced ? "padding-top: 18px;" : ""}">
                    ${sectionTitle(`Need install date · ${countLabel}`, "#ff6f00")}
                    ${wrapTable(body)}
                    </td></tr>
                    </table>`;
}

function snapshotBodyHtml(options: {
  jobs: WcSnapshotJob[];
  dated: WcSnapshotJob[];
  undated: WcSnapshotJob[];
  itemCount: number;
  deliveredCount: number;
  followUpCount: number;
  fieldUrl: string;
  showIntro: boolean;
}): string {
  const jobNoun = options.jobs.length === 1 ? "job" : "jobs";
  const itemNoun = options.itemCount === 1 ? "item" : "items";
  const followNoun = options.followUpCount === 1 ? "needs a follow-up" : "need a follow-up";
  const needNoun = options.undated.length === 1 ? "needs an install date" : "need an install date";

  const intro = options.showIntro
    ? ""
    : `<h2 style="margin: 0 0 12px 0; font-size: 22px; color: ${THEME.header}; border-bottom: 2px solid ${THEME.header}; padding-bottom: 8px; font-family: Arial, Helvetica, sans-serif;">Wallcovering snapshot</h2>
                    <p style="margin: 0 0 12px 0; font-size: 14px; color: ${THEME.header}; font-family: Arial, Helvetica, sans-serif;">
                      ${options.jobs.length} ${jobNoun}, ${options.itemCount} ${itemNoun}.
                      <span style="color: #4caf50; font-weight: bold;"> ${options.deliveredCount} delivered</span>,
                      <span style="color: #d32f2f; font-weight: bold;"> ${options.followUpCount} ${followNoun}</span>,
                      <span style="color: #ff6f00; font-weight: bold;"> ${options.undated.length} ${needNoun}</span>.
                    </p>`;

  const tables =
    options.dated.length || options.undated.length
      ? `${installDatesTableHtml(options.dated)}${needInstallDateTableHtml(options.undated, options.dated.length > 0)}`
      : `<p style="margin: 0; font-size: 14px; color: ${THEME.muted}; font-family: Arial, Helvetica, sans-serif;">No wallcovering jobs to show.</p>`;

  return `${intro}
                    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px;">
                      <tr>
                        ${legendDot("#4caf50", "#4caf50", "Delivered")}
                        ${legendDot("#1565c0", "#1565c0", "Shipped")}
                        ${legendDot("#ffffff", "#3a4d5c", "On track")}
                        ${legendDot("#ff9800", "#ff9800", "Needs follow-up")}
                        ${legendDot("#d32f2f", "#d32f2f", "Late or order now")}
                      </tr>
                    </table>
                    ${tables}
                    <table cellpadding="0" cellspacing="0" border="0" style="margin-top: 16px;">
                      <tr>
                        <td style="background-color: ${THEME.header}; border-radius: 4px;">
                          <a href="${options.fieldUrl}" style="display: inline-block; padding: 12px 20px; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none; font-family: Arial, Helvetica, sans-serif;">Open Material Tracker</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 16px 0 0 0; font-size: 11px; color: ${THEME.muted}; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
                      Jobs are grouped by install date. Projects with no date picked are listed under Need install date. An item needs a follow-up when it&apos;s ordered with no ship date inside 30 days of install, ships within 5 days of install, isn&apos;t ordered and its lead time runs past install, or has a revision requested.
                    </p>`;
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function digestFooter(companyName: string, companyAddress: string): string {
  return `<tr>
                  <td style="padding: 20px; background-color: ${THEME.header}; text-align: center; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${escHtml(companyName)} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: ${THEME.footerMuted}; font-family: Arial, Helvetica, sans-serif;">
                      ${escHtml(companyAddress)}
                    </p>
                  </td>
                </tr>`;
}

function summaryStat(value: string, label: string, color = THEME.header): string {
  return `<td width="25%" style="text-align: center;">
                          <p style="margin:0;font-size:24px;font-weight:bold;color:${color};font-family: Arial, Helvetica, sans-serif;">${escHtml(value)}</p>
                          <p style="margin:3px 0 0;font-size:11px;color:${THEME.header};text-transform:uppercase;font-weight:600;font-family: Arial, Helvetica, sans-serif;">${escHtml(label)}</p>
                        </td>`;
}

export function buildWallcoveringSnapshotHtml(options: {
  projects: ProjectForm[];
  branding: TrackerNotificationBranding;
  fieldViewUrl?: string;
  embed?: boolean;
}): string {
  const jobs = collectWallcoveringSnapshotJobs(options.projects);
  const dated = jobs.filter((job) => job.installDate);
  const undated = jobs.filter((job) => !job.installDate);
  const itemCount = jobs.reduce((sum, job) => sum + job.itemCount, 0);
  const deliveredCount = jobs.reduce((sum, job) => sum + job.deliveredCount, 0);
  const followUpCount = jobs.reduce(
    (sum, job) => sum + job.chips.filter((chip) => chip.tone === "follow_up" || chip.tone === "late").length,
    0,
  );
  const companyName = options.branding.companyName.trim() || "JobFlow";
  const companyAddress = options.branding.companyAddress.trim();
  const primaryName = escHtml(options.branding.primaryName.trim() || "PM");
  const body = snapshotBodyHtml({
    jobs,
    dated,
    undated,
    itemCount,
    deliveredCount,
    followUpCount,
    fieldUrl: escHtml(options.fieldViewUrl || fieldViewWallcoveringUrl()),
    showIntro: !options.embed,
  });

  if (options.embed) {
    return `<tr><td style="padding: 10px 20px 20px 20px;">${body}</td></tr>`;
  }

  return `<html>
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: ${THEME.pageBg};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${THEME.pageBg};">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px;">
                <tr>
                  <td style="background-color: ${THEME.header}; padding: 25px 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: bold;">Wallcovering snapshot</h1>
                    <p style="margin: 6px 0 0 0; color: ${THEME.headerMuted}; font-size: 14px;">Projects Managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${escHtml(formatTodayLong())}</p>
                  </td>
                </tr>
                <tr><td style="padding: 0; background-color: ${THEME.summaryBg};">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-bottom: 3px solid ${THEME.header};">
                      <tr>
                        ${summaryStat(String(jobs.length), "Jobs")}
                        ${summaryStat(String(itemCount), "Items")}
                        ${summaryStat(String(deliveredCount), "Delivered", "#4caf50")}
                        ${summaryStat(String(undated.length), "Need date", "#ff6f00")}
                      </tr>
                    </table>
                  </td></tr>
                <tr><td style="padding: 20px;">${body}</td></tr>
                ${digestFooter(companyName, companyAddress)}
              </table>
            </td></tr>
        </table>
      </body>
    </html>`;
}
