import { listDoneProjectIds } from "./projectDone";
import { supabase } from "./supabase";

export type ProjectNoteType = "note" | "follow_up" | "flag";
export type ProjectNoteStatus = "open" | "done";
export type ProjectNoteSnooze = "day" | "week";

export type ProjectNote = {
  id: string;
  project_id: string;
  body: string;
  type: ProjectNoteType;
  status: ProjectNoteStatus;
  follow_up_date: string | null;
  waiting_on: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AddProjectNoteInput = {
  body: string;
  type: ProjectNoteType;
  followUpDate?: string | null;
  waitingOn?: string | null;
};

export type UpdateProjectNotePatch = {
  body?: string;
  type?: ProjectNoteType;
  status?: ProjectNoteStatus;
  followUpDate?: string | null;
  waitingOn?: string | null;
  completedAt?: string | null;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Local calendar date as YYYY-MM-DD. */
export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Shift a calendar date by whole days. DST-safe because it uses the local date parts. */
export function shiftIsoDate(iso: string, days: number): string {
  if (!isIsoDate(iso)) throw new Error("Follow-up date must be YYYY-MM-DD.");
  const match = ISO_DATE.exec(iso)!;
  const next = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  next.setDate(next.getDate() + days);
  return localIsoDate(next);
}

/** Whole calendar days from earlier to later. Positive when later is after earlier. */
export function calendarDaysBetween(earlierIso: string, laterIso: string): number {
  if (!isIsoDate(earlierIso) || !isIsoDate(laterIso)) return 0;
  const earlier = ISO_DATE.exec(earlierIso)!;
  const later = ISO_DATE.exec(laterIso)!;
  const start = Date.UTC(Number(earlier[1]), Number(earlier[2]) - 1, Number(earlier[3]));
  const end = Date.UTC(Number(later[1]), Number(later[2]) - 1, Number(later[3]));
  return Math.round((end - start) / 86_400_000);
}

/**
 * +1 day or +1 week from today, or from the existing follow-up date when that date is later.
 */
/** Through the coming Sunday. Today is not included, so this is empty on Sunday. */
export function endOfCalendarWeek(today = localIsoDate()): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  const untilSunday = (7 - date.getDay()) % 7;
  return shiftIsoDate(today, untilSunday);
}

const noteListeners = new Set<() => void>();

/** Layout and other open screens refetch after a note is added, edited, or completed. */
export function subscribeProjectNotesChanged(listener: () => void): () => void {
  noteListeners.add(listener);
  return () => {
    noteListeners.delete(listener);
  };
}

function notifyProjectNotesChanged(): void {
  for (const listener of noteListeners) listener();
}

export function snoozeFollowUpDate(
  existing: string | null | undefined,
  amount: ProjectNoteSnooze,
  today = localIsoDate(),
): string {
  const base = existing && isIsoDate(existing) && existing > today ? existing : today;
  return shiftIsoDate(base, amount === "week" ? 7 : 1);
}

function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Write a note before saving it.");
  return trimmed;
}

function cleanDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isIsoDate(trimmed)) throw new Error("Follow-up date must be YYYY-MM-DD.");
  return trimmed;
}

function cleanWaitingOn(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapNote(row: {
  id: string;
  project_id: string;
  body: string;
  type: string;
  status: string;
  follow_up_date: string | null;
  waiting_on: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): ProjectNote {
  return {
    id: row.id,
    project_id: row.project_id,
    body: row.body,
    type: row.type === "follow_up" || row.type === "flag" ? row.type : "note",
    status: row.status === "done" ? "done" : "open",
    follow_up_date: row.follow_up_date,
    waiting_on: row.waiting_on,
    completed_at: row.completed_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type OpenProjectFollowUp = {
  id: string;
  projectId: string;
  jobNumber: string;
  jobName: string;
  body: string;
  type: "follow_up" | "flag";
  followUpDate: string | null;
};

function embeddedProject(
  value: { job_number: string | null; job_name: string | null } | { job_number: string | null; job_name: string | null }[] | null,
): { job_number: string | null; job_name: string | null } | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Open follow-ups and flags on every project, with the job number and name. */
export async function listOpenProjectFollowUps(): Promise<OpenProjectFollowUp[]> {
  const { data, error } = await supabase
    .from("project_notes")
    .select("id, project_id, body, type, follow_up_date, projects(job_number, job_name)")
    .eq("status", "open")
    .in("type", ["follow_up", "flag"])
    .order("follow_up_date", { ascending: true });
  fail(error);
  const rows: OpenProjectFollowUp[] = [];
  for (const row of data ?? []) {
    if (row.type !== "follow_up" && row.type !== "flag") continue;
    const project = embeddedProject(row.projects);
    if (!project) continue;
    rows.push({
      id: row.id,
      projectId: row.project_id,
      jobNumber: project.job_number ?? "",
      jobName: project.job_name ?? "",
      body: row.body,
      type: row.type,
      followUpDate: row.follow_up_date,
    });
  }
  return rows;
}

export type ProjectNoteWithJob = ProjectNote & {
  jobNumber: string;
  jobName: string;
};

/**
 * Every note on active (not done) jobs, with the job number and name.
 * Same project join as {@link listOpenProjectFollowUps}. Done jobs are left out.
 */
export async function listAllProjectNotes(): Promise<ProjectNoteWithJob[]> {
  const [{ data, error }, done] = await Promise.all([
    supabase
      .from("project_notes")
      .select("*, projects(job_number, job_name)")
      .order("created_at", { ascending: false }),
    listDoneProjectIds(),
  ]);
  fail(error);
  if (done.error) throw new Error(done.error);
  const doneIds = new Set(done.ids);
  const rows: ProjectNoteWithJob[] = [];
  for (const row of data ?? []) {
    if (doneIds.has(row.project_id)) continue;
    const project = embeddedProject(row.projects);
    if (!project) continue;
    if (row.type !== "note" && row.type !== "follow_up" && row.type !== "flag") continue;
    rows.push({
      ...mapNote(row),
      jobNumber: (project.job_number ?? "").trim(),
      jobName: (project.job_name ?? "").trim(),
    });
  }
  return rows;
}

/** Open follow-ups and flags dated before today. Same overdue rule as the Projects follow-ups card. */
export function countOpenOverdueNotes(rows: readonly { status: ProjectNoteStatus; type: ProjectNoteType; follow_up_date: string | null }[], today = localIsoDate()): number {
  let count = 0;
  for (const row of rows) {
    if (row.status !== "open" || row.type === "note") continue;
    if (row.follow_up_date && row.follow_up_date < today) count += 1;
  }
  return count;
}

export async function listProjectNotes(projectId: string): Promise<ProjectNote[]> {
  const { data, error } = await supabase
    .from("project_notes")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  fail(error);
  return (data ?? []).map(mapNote);
}

export async function addProjectNote(projectId: string, input: AddProjectNoteInput): Promise<ProjectNote> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("project_notes")
    .insert({
      project_id: projectId,
      body: cleanBody(input.body),
      type: input.type,
      follow_up_date: input.type === "note" ? null : cleanDate(input.followUpDate),
      waiting_on: input.type === "note" ? null : cleanWaitingOn(input.waitingOn),
      created_by: userData.user?.id ?? null,
    })
    .select("*")
    .single();
  fail(error);
  if (!data) throw new Error("Could not save the note.");
  const note = mapNote(data);
  notifyProjectNotesChanged();
  return note;
}

export async function updateProjectNote(id: string, patch: UpdateProjectNotePatch): Promise<ProjectNote> {
  const row: {
    body?: string;
    type?: ProjectNoteType;
    status?: ProjectNoteStatus;
    follow_up_date?: string | null;
    waiting_on?: string | null;
    completed_at?: string | null;
  } = {};
  if (patch.body !== undefined) row.body = cleanBody(patch.body);
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.followUpDate !== undefined) row.follow_up_date = cleanDate(patch.followUpDate);
  if (patch.waitingOn !== undefined) row.waiting_on = cleanWaitingOn(patch.waitingOn);
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;

  const { data, error } = await supabase.from("project_notes").update(row).eq("id", id).select("*").single();
  fail(error);
  if (!data) throw new Error("Note was not found.");
  const note = mapNote(data);
  notifyProjectNotesChanged();
  return note;
}

/** Mark done and stamp completed_at, or reopen and clear it. */
export async function toggleProjectNoteDone(id: string, status: ProjectNoteStatus): Promise<ProjectNote> {
  const done = status !== "done";
  return updateProjectNote(id, {
    status: done ? "done" : "open",
    completedAt: done ? new Date().toISOString() : null,
  });
}

/** Push the follow-up date out by a day or a week. */
export async function snoozeProjectNote(id: string, amount: ProjectNoteSnooze): Promise<ProjectNote> {
  const { data, error } = await supabase
    .from("project_notes")
    .select("follow_up_date")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!data) throw new Error("Note was not found.");
  return updateProjectNote(id, {
    followUpDate: snoozeFollowUpDate(data.follow_up_date, amount),
  });
}
