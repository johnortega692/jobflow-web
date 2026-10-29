import { embedLogoUrlInHtml } from "./emailImageEmbed.js";
import { jobflowPublicOrigin } from "./jobflowPublicUrl.js";
import { calendarDaysBetween, isIsoDate, localIsoDate } from "./projectNotes.js";
import { listDoneProjectIds } from "./projectDone.js";
import { sendVendorEmailAsOrderEmailDirect } from "./sendOrderEmailGasDirect.js";
import type { GasEmailPost } from "./sendVendorEmailGasDirect.js";
import type { SendVendorEmailRequest } from "./sendVendorEmail.js";
import { supabase } from "./supabase.js";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabaseAdmin.js";
import { resolveTrackerNotificationRecipients, type TrackerNotificationBranding } from "./trackerNotificationEmail.js";

const THEME = {
  header: "#3a4d5c",
  headerMuted: "#cbd5e1",
  summaryBg: "#d4e6f1",
  pageBg: "#f4f4f4",
  muted: "#666666",
  text: "#333333",
  overdue: "#d32f2f",
  footerMuted: "#b8d4e6",
};

export type NotesDigestLine = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  body: string;
  href: string;
  followUpDate: string | null;
  daysLate: number | null;
};

export type NotesDigestProject = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  href: string;
  overdue: NotesDigestLine[];
  dueToday: NotesDigestLine[];
  flags: NotesDigestLine[];
};

export type NotesDigestModel = {
  overdueCount: number;
  dueTodayCount: number;
  flagCount: number;
  projects: NotesDigestProject[];
  comingUp: NotesDigestLine[];
};

type NoteRow = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  body: string;
  type: "follow_up" | "flag";
  followUpDate: string | null;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function projectNotesHref(projectId: string): string {
  return `${jobflowPublicOrigin()}/projects/${projectId}/notes`;
}

/** Sunday of the calendar week that contains `todayIso`. Same day when today is Sunday. */
export function calendarWeekEndIso(todayIso: string): string {
  if (!isIsoDate(todayIso)) return todayIso;
  const [year, month, day] = todayIso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  return localIsoDate(date);
}

function compareJobNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function embeddedProject(value: unknown): { job_number: string; job_name: string } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const jobNumber = "job_number" in row ? String(row.job_number ?? "").trim() : "";
  const jobName = "job_name" in row ? String(row.job_name ?? "").trim() : "";
  if (!jobNumber && !jobName) return null;
  return { job_number: jobNumber, job_name: jobName };
}

/**
 * Open notes due today or overdue, plus every open flag.
 * Returns null when that set is empty so the caller sends nothing.
 * Coming up this week is extra and does not trigger a send on its own.
 */
export function buildNotesDigestModel(rows: NoteRow[], todayIso: string): NotesDigestModel | null {
  const weekEnd = calendarWeekEndIso(todayIso);
  const projects = new Map<string, NotesDigestProject>();
  const comingUp: NotesDigestLine[] = [];

  function projectFor(row: NoteRow): NotesDigestProject {
    const existing = projects.get(row.projectId);
    if (existing) return existing;
    const created: NotesDigestProject = {
      projectId: row.projectId,
      jobNumber: row.jobNumber,
      jobName: row.jobName,
      href: projectNotesHref(row.projectId),
      overdue: [],
      dueToday: [],
      flags: [],
    };
    projects.set(row.projectId, created);
    return created;
  }

  function line(row: NoteRow, daysLate: number | null): NotesDigestLine {
    return {
      projectId: row.projectId,
      jobNumber: row.jobNumber,
      jobName: row.jobName,
      body: row.body,
      href: projectNotesHref(row.projectId),
      followUpDate: row.followUpDate,
      daysLate,
    };
  }

  for (const row of rows) {
    const date = row.followUpDate && isIsoDate(row.followUpDate) ? row.followUpDate : null;
    if (date && date < todayIso) {
      projectFor(row).overdue.push(line(row, calendarDaysBetween(date, todayIso)));
      continue;
    }
    if (date && date === todayIso) {
      projectFor(row).dueToday.push(line(row, null));
      continue;
    }
    if (row.type === "flag") {
      projectFor(row).flags.push(line(row, null));
      continue;
    }
    if (date && date > todayIso && date <= weekEnd) comingUp.push(line(row, null));
  }

  const grouped = [...projects.values()]
    .map((project) => ({
      ...project,
      overdue: [...project.overdue].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || a.body.localeCompare(b.body)),
      dueToday: [...project.dueToday].sort((a, b) => a.body.localeCompare(b.body)),
      flags: [...project.flags].sort((a, b) => a.body.localeCompare(b.body)),
    }))
    .filter((project) => project.overdue.length || project.dueToday.length || project.flags.length)
    .sort((a, b) => compareJobNumber(a.jobNumber, b.jobNumber) || a.jobName.localeCompare(b.jobName));

  const overdueCount = grouped.reduce((sum, project) => sum + project.overdue.length, 0);
  const dueTodayCount = grouped.reduce((sum, project) => sum + project.dueToday.length, 0);
  const flagCount = grouped.reduce((sum, project) => sum + project.flags.length, 0);
  if (!overdueCount && !dueTodayCount && !flagCount) return null;

  comingUp.sort(
    (a, b) =>
      (a.followUpDate ?? "").localeCompare(b.followUpDate ?? "") ||
      compareJobNumber(a.jobNumber, b.jobNumber) ||
      a.body.localeCompare(b.body),
  );

  return { overdueCount, dueTodayCount, flagCount, projects: grouped, comingUp };
}

export function notesDigestSubject(dueToday: number, overdue: number): string {
  return `Follow-ups: ${dueToday} due today, ${overdue} overdue`;
}

function formatTodayLong(today: Date): string {
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function daysLateLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"} late`;
}

function jobLabel(jobNumber: string, jobName: string): string {
  return [jobNumber, jobName].filter(Boolean).join(" · ");
}

function itemLink(item: NotesDigestLine, color: string): string {
  const late =
    item.daysLate != null
      ? ` <span style="color: ${THEME.overdue}; font-weight: bold;">· ${escHtml(daysLateLabel(item.daysLate))}</span>`
      : "";
  return `<p style="margin: 0 0 6px 0; font-size: 14px; line-height: 1.4; font-family: Arial, Helvetica, sans-serif;">
    <a href="${escHtml(item.href)}" style="color: ${color}; text-decoration: none;">${escHtml(item.body)}</a>${late}
  </p>`;
}

function groupBlock(title: string, items: NotesDigestLine[], color: string): string {
  if (!items.length) return "";
  const rows = items.map((item) => itemLink(item, color)).join("");
  return `<p style="margin: 10px 0 4px 0; font-size: 11px; font-weight: bold; letter-spacing: 0.04em; text-transform: uppercase; color: ${color}; font-family: Arial, Helvetica, sans-serif;">${escHtml(title)}</p>${rows}`;
}

function projectSection(project: NotesDigestProject): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 16px;">
    <tr><td style="padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">
      <a href="${escHtml(project.href)}" style="color: ${THEME.header}; font-size: 16px; font-weight: bold; text-decoration: none; font-family: Arial, Helvetica, sans-serif;">${escHtml(jobLabel(project.jobNumber, project.jobName))}</a>
    </td></tr>
    <tr><td style="padding-top: 4px;">
      ${groupBlock("Overdue", project.overdue, THEME.overdue)}
      ${groupBlock("Due today", project.dueToday, THEME.text)}
      ${groupBlock("Flags", project.flags, THEME.header)}
    </td></tr>
  </table>`;
}

function comingUpSection(items: NotesDigestLine[]): string {
  if (!items.length) return "";
  const rows = items
    .map((item) => {
      const when = item.followUpDate ? formatShortDate(item.followUpDate) : "";
      return `<p style="margin: 0 0 6px 0; font-size: 13px; line-height: 1.4; color: ${THEME.text}; font-family: Arial, Helvetica, sans-serif;">
        <a href="${escHtml(item.href)}" style="color: #1a73e8; text-decoration: none;">${escHtml(jobLabel(item.jobNumber, item.jobName))}</a>
        — ${escHtml(item.body)}${when ? ` · ${escHtml(when)}` : ""}
      </p>`;
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 22px;">
    <tr><td>
      <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: ${THEME.header}; font-family: Arial, Helvetica, sans-serif;">Coming up this week</p>
      ${rows}
    </td></tr>
  </table>`;
}

export function buildNotesDigestHtml(options: {
  model: NotesDigestModel;
  branding: TrackerNotificationBranding;
  today: Date;
}): string {
  const { model, branding, today } = options;
  const companyName = branding.companyName.trim() || "JobFlow";
  const companyAddress = branding.companyAddress.trim();
  const primaryName = escHtml(branding.primaryName.trim() || "PM");
  const sections = model.projects.map(projectSection).join("");
  return `<html>
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: ${THEME.pageBg};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${THEME.pageBg};">
          <tr><td align="center" style="padding: 20px 0;">
              <table width="650" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px;">
                <tr>
                  <td style="background-color: ${THEME.header}; padding: 25px 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: bold;">Follow-ups</h1>
                    <p style="margin: 6px 0 0 0; color: ${THEME.headerMuted}; font-size: 14px;">Projects managed by ${primaryName}</p>
                    <p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px;">${escHtml(formatTodayLong(today))}</p>
                  </td>
                </tr>
                <tr><td style="padding: 0; background-color: ${THEME.summaryBg};">
                    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="border-bottom: 3px solid ${THEME.header};">
                      <tr>
                        <td width="33%" style="text-align: center;">
                          <p style="margin:0;font-size:24px;font-weight:bold;color:${THEME.overdue};font-family: Arial, Helvetica, sans-serif;">${model.overdueCount}</p>
                          <p style="margin:3px 0 0;font-size:11px;color:${THEME.header};text-transform:uppercase;font-weight:600;font-family: Arial, Helvetica, sans-serif;">Overdue</p>
                        </td>
                        <td width="33%" style="text-align: center;">
                          <p style="margin:0;font-size:24px;font-weight:bold;color:${THEME.header};font-family: Arial, Helvetica, sans-serif;">${model.dueTodayCount}</p>
                          <p style="margin:3px 0 0;font-size:11px;color:${THEME.header};text-transform:uppercase;font-weight:600;font-family: Arial, Helvetica, sans-serif;">Due today</p>
                        </td>
                        <td width="34%" style="text-align: center;">
                          <p style="margin:0;font-size:24px;font-weight:bold;color:${THEME.header};font-family: Arial, Helvetica, sans-serif;">${model.flagCount}</p>
                          <p style="margin:3px 0 0;font-size:11px;color:${THEME.header};text-transform:uppercase;font-weight:600;font-family: Arial, Helvetica, sans-serif;">Flags</p>
                        </td>
                      </tr>
                    </table>
                  </td></tr>
                <tr><td style="padding: 8px 20px 20px 20px;">
                    ${sections}
                    ${comingUpSection(model.comingUp)}
                  </td></tr>
                <tr>
                  <td style="padding: 20px; background-color: ${THEME.header}; text-align: center; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0 0 3px 0; font-size: 11px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                      Automated notification from ${escHtml(companyName)} Dashboard
                    </p>
                    <p style="margin: 0; font-size: 10px; color: ${THEME.footerMuted}; font-family: Arial, Helvetica, sans-serif;">
                      ${escHtml(companyAddress)}
                    </p>
                  </td>
                </tr>
              </table>
            </td></tr>
        </table>
      </body>
    </html>`;
}

function digestPlainText(model: NotesDigestModel): string {
  const lines = [notesDigestSubject(model.dueTodayCount, model.overdueCount), ""];
  for (const project of model.projects) {
    lines.push(jobLabel(project.jobNumber, project.jobName));
    lines.push(project.href);
    for (const item of project.overdue) {
      lines.push(`- ${item.body} (${daysLateLabel(item.daysLate ?? 0)})`);
    }
    for (const item of project.dueToday) lines.push(`- ${item.body} (due today)`);
    for (const item of project.flags) lines.push(`- ${item.body} (flag)`);
    lines.push("");
  }
  if (model.comingUp.length) {
    lines.push("Coming up this week");
    for (const item of model.comingUp) {
      const when = item.followUpDate ? formatShortDate(item.followUpDate) : "";
      lines.push(`- ${jobLabel(item.jobNumber, item.jobName)}: ${item.body}${when ? ` (${when})` : ""}`);
    }
  }
  return lines.join("\n").trim();
}

async function doneProjectIds(): Promise<Set<string>> {
  if (isSupabaseAdminConfigured()) {
    const { data, error } = await getSupabaseAdmin()
      .from("manpower_project_status" as never)
      .select("project_id")
      .eq("is_done", true as never);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as { project_id: string }[]).map((row) => row.project_id));
  }
  const { ids, error } = await listDoneProjectIds();
  if (error) throw new Error(error);
  return new Set(ids);
}

async function loadOpenFollowUpRows(allowedProjectIds: Set<string>): Promise<NoteRow[]> {
  const client = isSupabaseAdminConfigured() ? getSupabaseAdmin() : supabase;
  const { data, error } = await client
    .from("project_notes")
    .select("id, project_id, body, type, follow_up_date, projects(job_number, job_name)")
    .eq("status", "open")
    .in("type", ["follow_up", "flag"]);
  if (error) throw new Error(error.message);

  const done = await doneProjectIds();
  const rows: NoteRow[] = [];
  for (const raw of data ?? []) {
    if (!allowedProjectIds.has(raw.project_id) || done.has(raw.project_id)) continue;
    const project = embeddedProject(raw.projects);
    if (!project) continue;
    const body = raw.body.trim();
    if (!body) continue;
    if (raw.type !== "follow_up" && raw.type !== "flag") continue;
    rows.push({
      projectId: raw.project_id,
      jobNumber: project.job_number,
      jobName: project.job_name,
      body,
      type: raw.type,
      followUpDate: raw.follow_up_date,
    });
  }
  return rows;
}

export async function sendNotesDigest(options: {
  projects: { id: string }[];
  primaryEmail: string;
  primaryName: string;
  companyName: string;
  companyAddress: string;
  fromName: string;
  gasUrl: string;
  logoUrl?: string;
  gasPost?: GasEmailPost;
  today: Date;
}): Promise<{ sent: boolean; overdue: number; dueToday: number; flags: number }> {
  const empty = { sent: false, overdue: 0, dueToday: 0, flags: 0 };
  const todayIso = localIsoDate(options.today);
  const rows = await loadOpenFollowUpRows(new Set(options.projects.map((project) => project.id)));
  const model = buildNotesDigestModel(rows, todayIso);
  if (!model) return empty;

  const recipients = resolveTrackerNotificationRecipients(options.primaryEmail);
  if (!recipients) {
    throw new Error("Set email on your Profile (Settings → My Profile).");
  }

  const branding: TrackerNotificationBranding = {
    companyName: options.companyName,
    companyAddress: options.companyAddress,
    primaryName: options.primaryName,
  };
  const html = await embedLogoUrlInHtml(
    buildNotesDigestHtml({ model, branding, today: options.today }),
    options.logoUrl ?? "",
  );
  const payload: SendVendorEmailRequest = {
    to: recipients.to,
    cc: [],
    subject: notesDigestSubject(model.dueTodayCount, model.overdueCount),
    html,
    text: digestPlainText(model),
    from_name: options.fromName,
  };

  if (options.gasPost) {
    await options.gasPost(options.gasUrl, payload);
  } else {
    await sendVendorEmailAsOrderEmailDirect(options.gasUrl, payload);
  }

  return {
    sent: true,
    overdue: model.overdueCount,
    dueToday: model.dueTodayCount,
    flags: model.flagCount,
  };
}
