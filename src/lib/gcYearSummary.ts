import {
  frpJobName,
  frpJobNumber,
  hasDistinctFrpContract,
  hasDistinctTrackContract,
  hasDistinctWcContract,
  trackJobName,
  trackJobNumber,
  TRANSMITTAL_CONTRACT_LABELS,
  wcTrackerJobName,
  wcTrackerJobNumber,
  type TransmittalContract,
} from "./jobInfo";
import { parseMoney } from "./workOrderCalc";
import { normalizeProject, type Project, type ProjectForm } from "../types/database";

const NO_GC = "No GC";
export const GC_JOB_PREVIEW_LIMIT = 3;

export type JobWorkStatus = "not_started" | "in_progress" | "complete";

export const JOB_WORK_STATUS_LABEL: Record<JobWorkStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};

export type GcYearJob = {
  id: string;
  lineId: string;
  jobNumber: string;
  jobName: string;
  trade: string;
  contractAmount: number;
  openAmount: number;
  status: JobWorkStatus;
  done: boolean;
};

export type GcYearGroup = {
  key: string;
  gc: string;
  qty: number;
  contractAmount: number;
  openAmount: number;
  statusCounts: Record<JobWorkStatus, number>;
  jobs: GcYearJob[];
};

export type GcYearSummary = {
  year: number;
  groups: GcYearGroup[];
  totalQty: number;
  totalAmount: number;
  openAmount: number;
  openQty: number;
  completedAmount: number;
  completedQty: number;
  priorYearAmount: number;
  featuredGcShare: { name: string; percent: number } | null;
  duplicateWarnings: string[][];
};

export function currentCalendarYear(): number {
  return new Date().getFullYear();
}

export function yearFromDateText(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const yearMatch = trimmed.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  if (yearMatch) return Number(yearMatch[1]);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getFullYear();
}

export function parseFlexibleDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function yearFromProject(project: Project): number | null {
  const form = normalizeProject(project);
  return (
    yearFromDateText(form.jobInfo.job_date) ??
    yearFromDateText(form.jobInfo.start_date) ??
    yearFromDateText(project.created_at ?? "")
  );
}

export function jobWorkStatus(done: boolean, startDate: string, asOf = new Date()): JobWorkStatus {
  if (done) return "complete";
  const start = parseFlexibleDate(startDate);
  if (!start) return "not_started";
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return start > today ? "not_started" : "in_progress";
}

function includeTradeContract(distinct: boolean, amountRaw: string): boolean {
  return Boolean(amountRaw.trim()) || distinct;
}

/** True when the job title looks like an app-testing placeholder, not a real job. */
export function isTestJobName(name: string): boolean {
  return /\btest\b/i.test(name.trim());
}

const EXCLUDED_JOB_NAMES = new Set(["c928 exterior paint"]);

function normalizeJobNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Hide test placeholders and known mistaken job titles. Matches name only, never job number. */
export function isExcludedJobName(name: string): boolean {
  const normalized = normalizeJobNameKey(name);
  return isTestJobName(normalized) || EXCLUDED_JOB_NAMES.has(normalized);
}

function emptyStatusCounts(): Record<JobWorkStatus, number> {
  return { not_started: 0, in_progress: 0, complete: 0 };
}

function groupFromJobs(key: string, gc: string, jobs: GcYearJob[]): GcYearGroup {
  const statusCounts = emptyStatusCounts();
  let contractAmount = 0;
  let openAmount = 0;
  for (const job of jobs) {
    statusCounts[job.status] += 1;
    contractAmount += job.contractAmount;
    openAmount += job.openAmount;
  }
  const sorted = [...jobs].sort((a, b) => {
    const order: Record<JobWorkStatus, number> = { not_started: 0, in_progress: 1, complete: 2 };
    return order[a.status] - order[b.status] || a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true });
  });
  return {
    key,
    gc,
    qty: sorted.length,
    contractAmount,
    openAmount,
    statusCounts,
    jobs: sorted,
  };
}

/** One row per paint / wallcovering / FRP / track contract on the project. */
export function projectContractLines(form: ProjectForm, done: boolean): GcYearJob[] {
  const info = form.jobInfo;
  const status = jobWorkStatus(done, info.start_date);
  const lines: GcYearJob[] = [];

  function push(
    trade: TransmittalContract,
    jobNumber: string,
    jobName: string,
    amountRaw: string,
  ) {
    const contractAmount = parseMoney(amountRaw);
    lines.push({
      id: form.id,
      lineId: `${form.id}-${trade}`,
      jobNumber: jobNumber.trim() || "—",
      jobName: jobName.trim() || "Untitled job",
      trade: TRANSMITTAL_CONTRACT_LABELS[trade],
      contractAmount,
      openAmount: status === "complete" ? 0 : contractAmount,
      status,
      done,
    });
  }

  push("paint", form.job_number, form.job_name, info.contract_amount);

  if (includeTradeContract(hasDistinctWcContract(form), info.wc_contract_amount)) {
    push("wallcovering", wcTrackerJobNumber(form), wcTrackerJobName(form), info.wc_contract_amount);
  }
  if (includeTradeContract(hasDistinctFrpContract(form), info.frp_contract_amount)) {
    push("frp", frpJobNumber(form), frpJobName(form), info.frp_contract_amount);
  }
  if (includeTradeContract(hasDistinctTrackContract(form), info.track_contract_amount)) {
    push("track", trackJobNumber(form), trackJobName(form), info.track_contract_amount);
  }

  return lines;
}

export function formatContractUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  if (rounded > 0) return `▲ ${abs}%`;
  if (rounded < 0) return `▼ ${abs}%`;
  return "0%";
}

function gcKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function gcLabel(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed || NO_GC;
}

function gcNameCore(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"/\\()&-]/g, " ")
    .replace(/\b(construction|contractors?|inc|llc|co|company|builders?|corp|ltd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function yearsFromProjects(projects: Project[]): number[] {
  const years = new Set<number>();
  years.add(currentCalendarYear());
  for (const project of projects) {
    const year = yearFromProject(project);
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

function pickGcLabel(labels: Map<string, number>): string {
  let gc = NO_GC;
  let best = -1;
  for (const [label, count] of labels) {
    if (count > best || (count === best && label.length > gc.length)) {
      gc = label;
      best = count;
    }
  }
  return gc;
}

function groupsForYear(projects: Project[], year: number, doneIds: Set<string>): GcYearGroup[] {
  const buckets = new Map<string, { labels: Map<string, number>; jobs: GcYearJob[] }>();

  for (const project of projects) {
    if (yearFromProject(project) !== year) continue;
    const form = normalizeProject(project);
    if (isExcludedJobName(form.job_name)) continue;
    const label = gcLabel(form.contractor);
    const key = gcKey(form.contractor);
    const lines = projectContractLines(form, doneIds.has(project.id)).filter(
      (line) => !isExcludedJobName(line.jobName),
    );
    if (!lines.length) continue;
    const bucket = buckets.get(key) ?? { labels: new Map<string, number>(), jobs: [] };
    bucket.labels.set(label, (bucket.labels.get(label) ?? 0) + 1);
    bucket.jobs.push(...lines);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.entries()].map(([key, bucket]) =>
    groupFromJobs(key, pickGcLabel(bucket.labels), bucket.jobs),
  );
  groups.sort((a, b) => b.contractAmount - a.contractAmount || a.gc.localeCompare(b.gc));
  return groups;
}

function featuredGcShare(groups: GcYearGroup[], totalAmount: number): { name: string; percent: number } | null {
  if (!groups.length || totalAmount <= 0) return null;
  const icbi = groups.find((g) => g.key === "icbi");
  const featured = icbi ?? groups[0]!;
  return { name: featured.gc, percent: Math.round((featured.contractAmount / totalAmount) * 100) };
}

export function findDuplicateGcNames(groups: GcYearGroup[]): string[][] {
  const byCore = new Map<string, Set<string>>();
  for (const group of groups) {
    if (group.gc === NO_GC) continue;
    const core = gcNameCore(group.gc);
    if (!core) continue;
    const names = byCore.get(core) ?? new Set<string>();
    names.add(group.gc);
    byCore.set(core, names);
  }
  return [...byCore.values()]
    .map((names) => [...names].sort((a, b) => a.localeCompare(b)))
    .filter((names) => names.length > 1);
}

export type GcYearStatusFilter = "all" | "open" | "completed";

export function filterGcYearGroups(
  groups: GcYearGroup[],
  statusFilter: GcYearStatusFilter,
  gcQuery: string,
): GcYearGroup[] {
  const q = gcQuery.trim().toLowerCase();
  return groups
    .filter((group) => !q || group.gc.toLowerCase().includes(q))
    .map((group) => {
      if (statusFilter === "all") return group;
      const jobs =
        statusFilter === "open"
          ? group.jobs.filter((job) => job.status !== "complete")
          : group.jobs.filter((job) => job.status === "complete");
      return groupFromJobs(group.key, group.gc, jobs);
    })
    .filter((group) => group.qty > 0);
}

export function yoyChangePercent(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

export function buildGcYearSummary(
  projects: Project[],
  year: number,
  doneIds: Set<string>,
): GcYearSummary {
  const groups = groupsForYear(projects, year, doneIds);
  const priorGroups = groupsForYear(projects, year - 1, doneIds);
  const totalAmount = groups.reduce((sum, g) => sum + g.contractAmount, 0);
  const openAmount = groups.reduce((sum, g) => sum + g.openAmount, 0);
  const completedAmount = groups.reduce(
    (sum, g) => sum + g.jobs.filter((j) => j.status === "complete").reduce((s, j) => s + j.contractAmount, 0),
    0,
  );
  const openQty = groups.reduce((sum, g) => sum + g.statusCounts.not_started + g.statusCounts.in_progress, 0);
  const completedQty = groups.reduce((sum, g) => sum + g.statusCounts.complete, 0);

  return {
    year,
    groups,
    totalQty: groups.reduce((sum, g) => sum + g.qty, 0),
    totalAmount,
    openAmount,
    openQty,
    completedAmount,
    completedQty,
    priorYearAmount: priorGroups.reduce((sum, g) => sum + g.contractAmount, 0),
    featuredGcShare: featuredGcShare(groups, totalAmount),
    duplicateWarnings: findDuplicateGcNames(groups),
  };
}
