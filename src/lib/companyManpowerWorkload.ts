import { dateToKey, keyToDate } from "./fieldCalendarEvents";
import { HOURS_PER_MAN_WEEK, mondayOnOrBefore } from "./manpowerCalendar";
import { supabase } from "./supabase";
import { fieldViewRpcAuthArgs, loadFieldViewSession } from "./fieldViewAuth";

/** Planned hours below this = light / slow week (~2 people). */
export const WORKLOAD_LIGHT_MAX_HOURS = 80;
/** Planned hours above this = heavy week (~8+ people). */
export const WORKLOAD_HEAVY_MIN_HOURS = 320;
/** Default crew capacity line on the workload bar chart. */
export const WORKLOAD_CAPACITY_PEOPLE = 10;

export type WorkloadBand = "light" | "normal" | "heavy" | "empty";

export type CompanyWorkloadJob = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  phaseId: string;
  phaseName: string;
  hours: number;
};

export type CompanyWorkloadWeek = {
  weekStart: string;
  totalHours: number;
  jobs: CompanyWorkloadJob[];
};

type RemoteWorkloadJob = {
  project_id: string;
  job_number: string;
  job_name: string;
  phase_id: string;
  phase_name: string;
  hours: number;
};

type RemoteWorkloadWeek = {
  week_start: string;
  total_hours: number;
  jobs: RemoteWorkloadJob[];
};

export function workloadBand(totalHours: number): WorkloadBand {
  if (totalHours <= 0) return "empty";
  if (totalHours < WORKLOAD_LIGHT_MAX_HOURS) return "light";
  if (totalHours > WORKLOAD_HEAVY_MIN_HOURS) return "heavy";
  return "normal";
}

export function workloadBandLabel(band: WorkloadBand): string {
  switch (band) {
    case "light":
      return "Light";
    case "heavy":
      return "Heavy";
    case "normal":
      return "Normal";
    default:
      return "No plan";
  }
}

export function formatPlannedHours(hours: number): string {
  if (hours <= 0) return "0 hrs";
  return `${Math.round(hours)} hrs`;
}

export function formatManWeeks(hours: number): string {
  if (hours <= 0) return "0";
  const mw = hours / HOURS_PER_MAN_WEEK;
  return Number.isInteger(mw) ? String(mw) : mw.toFixed(1);
}

export function hoursToPeople(hours: number): number {
  return hours / HOURS_PER_MAN_WEEK;
}

export function formatPeople(hours: number): string {
  if (hours <= 0) return "0";
  const people = hoursToPeople(hours);
  return Number.isInteger(people) ? String(people) : people.toFixed(1);
}

const WORKLOAD_CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#db2777",
  "#ea580c",
  "#64748b",
];

export type WorkloadChartJob = {
  key: string;
  label: string;
  color: string;
};

export type WorkloadChartSegment = {
  key: string;
  label: string;
  hours: number;
  people: number;
};

export type WorkloadChartWeek = {
  weekStart: string;
  /** Sunday-start key used for x-axis labels when filling the visible range. */
  labelWeekStart: string;
  totalHours: number;
  totalPeople: number;
  segments: WorkloadChartSegment[];
};

function projectChartKey(projectId: string, jobNumber: string, jobName: string): string {
  return projectId || `${jobNumber}:${jobName}`;
}

function projectChartLabel(jobNumber: string, jobName: string): string {
  return jobNumber ? `#${jobNumber} ${jobName}` : jobName;
}

export function chartVisibleSundayWeekStarts(viewMonth: Date): string[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const rangeStart = new Date(monthStart);
  rangeStart.setDate(monthStart.getDate() - monthStart.getDay() - 7);
  const monthEnd = new Date(year, month + 1, 0);
  const rangeEnd = new Date(monthEnd);
  rangeEnd.setDate(monthEnd.getDate() - monthEnd.getDay() + 7);

  const weeks: string[] = [];
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    weeks.push(dateToKey(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

/** Map a Sunday-start display week to the Monday rollup key used in workload data. */
export function sundayWeekToRollupKey(sundayIso: string): string {
  const sunday = keyToDate(sundayIso);
  if (!sunday) return sundayIso;
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() + 1);
  return dateToKey(monday);
}

export function buildWorkloadChartModel(
  weeks: CompanyWorkloadWeek[],
  options?: { maxJobs?: number; capacityPeople?: number; visibleSundayWeeks?: string[] },
): {
  weeks: WorkloadChartWeek[];
  jobs: WorkloadChartJob[];
  capacityPeople: number | null;
  yMax: number;
} {
  const maxJobs = options?.maxJobs ?? 6;
  const capacityPeople = options?.capacityPeople;
  const visibleSundayWeeks = options?.visibleSundayWeeks;
  const totals = new Map<string, { label: string; hours: number }>();

  for (const week of weeks) {
    for (const job of week.jobs) {
      const key = projectChartKey(job.projectId, job.jobNumber, job.jobName);
      const label = projectChartLabel(job.jobNumber, job.jobName);
      const existing = totals.get(key) ?? { label, hours: 0 };
      existing.hours += job.hours;
      totals.set(key, existing);
    }
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1].hours - a[1].hours);
  const featured = ranked.slice(0, maxJobs);
  const otherCount = ranked.length - featured.length;
  const otherKey = "__other__";

  const jobs: WorkloadChartJob[] = featured.map(([key, meta], index) => ({
    key,
    label: meta.label,
    color: WORKLOAD_CHART_COLORS[index % WORKLOAD_CHART_COLORS.length],
  }));

  if (otherCount > 0) {
    jobs.push({
      key: otherKey,
      label: `Other (${otherCount} job${otherCount === 1 ? "" : "s"})`,
      color: WORKLOAD_CHART_COLORS[6],
    });
  }

  const featuredKeys = new Set(featured.map(([key]) => key));
  const weekByRollupKey = new Map(weeks.map((week) => [week.weekStart, week]));

  const sourceWeeks =
    visibleSundayWeeks?.map((sundayStart) => {
      const rollupKey = sundayWeekToRollupKey(sundayStart);
      return {
        rollupKey,
        labelWeekStart: sundayStart,
        week: weekByRollupKey.get(rollupKey) ?? {
          weekStart: rollupKey,
          totalHours: 0,
          jobs: [],
        },
      };
    }) ??
    weeks.map((week) => ({
      rollupKey: week.weekStart,
      labelWeekStart: week.weekStart,
      week,
    }));

  const chartWeeks: WorkloadChartWeek[] = sourceWeeks.map(({ rollupKey, labelWeekStart, week }) => {
      const byKey = new Map<string, WorkloadChartSegment>();

      for (const job of week.jobs) {
        const key = projectChartKey(job.projectId, job.jobNumber, job.jobName);
        const segmentKey = featuredKeys.has(key) ? key : otherKey;
        if (!featuredKeys.has(key) && otherCount === 0) continue;
        const label =
          segmentKey === otherKey
            ? jobs.find((j) => j.key === otherKey)?.label ?? "Other"
            : projectChartLabel(job.jobNumber, job.jobName);
        const existing = byKey.get(segmentKey) ?? { key: segmentKey, label, hours: 0, people: 0 };
        existing.hours += job.hours;
        existing.people = hoursToPeople(existing.hours);
        byKey.set(segmentKey, existing);
      }

      const segments = jobs
        .map((job) => byKey.get(job.key))
        .filter((segment): segment is WorkloadChartSegment => Boolean(segment && segment.hours > 0));

      const totalHours = week.totalHours;
      return {
        weekStart: rollupKey,
        labelWeekStart,
        totalHours,
        totalPeople: hoursToPeople(totalHours),
        segments,
      };
    });

  const peakPeople = chartWeeks.reduce((max, week) => Math.max(max, week.totalPeople), 0);
  const yMax =
    capacityPeople != null && capacityPeople > 0
      ? Math.max(capacityPeople, Math.ceil(peakPeople), 1)
      : Math.max(Math.ceil(peakPeople), 1);

  return { weeks: chartWeeks, jobs, capacityPeople: capacityPeople ?? null, yMax };
}

export function formatWorkloadWeekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function weekStartKeyForDate(date: Date): string {
  return dateToKey(mondayOnOrBefore(date));
}

function normalizeWeek(raw: RemoteWorkloadWeek): CompanyWorkloadWeek {
  return {
    weekStart: raw.week_start,
    totalHours: Number(raw.total_hours) || 0,
    jobs: (raw.jobs ?? []).map((j) => ({
      projectId: j.project_id,
      jobNumber: j.job_number,
      jobName: j.job_name,
      phaseId: j.phase_id,
      phaseName: j.phase_name,
      hours: Number(j.hours) || 0,
    })),
  };
}

function parseWorkloadResponse(data: unknown): CompanyWorkloadWeek[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => normalizeWeek(row as RemoteWorkloadWeek));
}

export function workloadWeekMap(weeks: CompanyWorkloadWeek[]): Map<string, CompanyWorkloadWeek> {
  return new Map(weeks.map((w) => [w.weekStart, w]));
}

export function monthWeekRange(viewMonth: Date): { from: string; to: string } {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const gridStart = new Date(year, month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  return {
    from: dateToKey(mondayOnOrBefore(gridStart)),
    to: dateToKey(mondayOnOrBefore(gridEnd)),
  };
}

export async function fetchCompanyManpowerWorkload(fromWeek: string, toWeek: string): Promise<CompanyWorkloadWeek[]> {
  const { data, error } = await supabase.rpc("get_company_manpower_workload", {
    p_from_week: fromWeek,
    p_to_week: toWeek,
  } as never);
  if (error) throw new Error(error.message);
  return parseWorkloadResponse(data);
}

export async function fetchFieldViewCompanyManpowerWorkload(
  fromWeek: string,
  toWeek: string,
): Promise<CompanyWorkloadWeek[]> {
  const session = loadFieldViewSession();
  const auth = fieldViewRpcAuthArgs(session);
  if (!auth.p_caller_id || !auth.p_session_token) {
    throw new Error("Sign in to Field View to load the workload calendar.");
  }
  const { data, error } = await supabase.rpc("field_view_company_manpower_workload", {
    ...auth,
    p_from_week: fromWeek,
    p_to_week: toWeek,
  } as never);
  if (error) throw new Error(error.message);
  return parseWorkloadResponse(data);
}

/** Active roster headcount — same filter as Manpower Cal get_state employees (active only). */
export async function fetchCompanyManpowerActiveCrew(): Promise<number> {
  const { data, error } = await supabase.rpc("get_company_manpower_active_crew" as never);
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

export async function fetchFieldViewManpowerActiveCrew(): Promise<number> {
  const session = loadFieldViewSession();
  const auth = fieldViewRpcAuthArgs(session);
  if (!auth.p_caller_id || !auth.p_session_token) {
    throw new Error("Sign in to Field View to load crew capacity.");
  }
  const { data, error } = await supabase.rpc("field_view_company_manpower_active_crew" as never, auth as never);
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

export function aggregateJobsByProject(jobs: CompanyWorkloadJob[]): {
  projectId: string;
  jobNumber: string;
  jobName: string;
  totalHours: number;
  phases: { phaseName: string; hours: number }[];
}[] {
  const byProject = new Map<
    string,
    {
      projectId: string;
      jobNumber: string;
      jobName: string;
      totalHours: number;
      phases: { phaseName: string; hours: number }[];
    }
  >();

  for (const job of jobs) {
    const key = job.projectId || `${job.jobNumber}:${job.jobName}`;
    const existing = byProject.get(key) ?? {
      projectId: job.projectId,
      jobNumber: job.jobNumber,
      jobName: job.jobName,
      totalHours: 0,
      phases: [],
    };
    existing.totalHours += job.hours;
    existing.phases.push({ phaseName: job.phaseName, hours: job.hours });
    byProject.set(key, existing);
  }

  return [...byProject.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
}
