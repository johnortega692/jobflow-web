export type ApGlOption = {
  label: string;
  gl: string;
  costClass: string;
};

/** Friendly GL labels from the Bluebeam AP stamp, and the values written on the stamp. */
export const AP_GL_OPTIONS: ApGlOption[] = [
  { label: "51000 - Labor (ICBI employees)", gl: "51000", costClass: "1 - Labor (ICBI employees)" },
  { label: "52000 - Materials", gl: "52000", costClass: "2 - Materials" },
  { label: "53000 - Subcontractors", gl: "53000", costClass: "3 - Subcontractors" },
  { label: "58000 - Owned Equipment", gl: "58000", costClass: "4 - Owned Equipment" },
  { label: "58500 - Rented Equipment", gl: "58500", costClass: "5 - Rented Equipment" },
  { label: "55000 - Misc/Other Cost", gl: "55000", costClass: "7 - Misc/Other Cost" },
];

export const DEFAULT_AP_GL = AP_GL_OPTIONS[1]!.label;

export const DEFAULT_AP_COST_CODES = [
  "970 - Paint Materials",
  "975 - Paint Shop Materials",
  "997 - Paint Equipment",
];

const CUSTOM_KEY = "jobflow.apCustomCodes";
const COUNT_KEY = "jobflow.apJobCounts";
const LAST_KEY = "jobflow.apLastStamp";

export type LastStampSettings = {
  gl: string;
  costCode: string;
  customCode: string;
  rememberCode: boolean;
  approved: string;
};

export function apGlOption(label: string): ApGlOption {
  return AP_GL_OPTIONS.find((option) => option.label === label) ?? AP_GL_OPTIONS[1]!;
}

export function padStampSeq(n: number): string {
  const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return String(value).padStart(3, "0");
}

export function notesForJob(job: string, previousCount: number): string {
  return `Approved ${job.trim()}-${padStampSeq(previousCount + 1)}`;
}

export function notesAreAutomatic(notes: string): boolean {
  const text = notes.trim();
  return text === "" || text.startsWith("Approved ");
}

/** The sequence already written in "Approved {job}-003", or null when notes are not that line. */
export function sequenceUsedInNotes(job: string, notes: string): number | null {
  const trimmedJob = job.trim();
  if (!trimmedJob) return null;
  const prefix = `Approved ${trimmedJob}-`;
  if (!notes.startsWith(prefix)) return null;
  const used = Number.parseInt(notes.slice(prefix.length), 10);
  return Number.isFinite(used) ? used : null;
}

export function mergeCustomCode(saved: string[], custom: string, remember: boolean): string[] {
  const value = custom.trim();
  if (!remember || !value) return saved;
  if (saved.includes(value) || DEFAULT_AP_COST_CODES.includes(value)) return saved;
  return [...saved, value];
}

/** Raise the saved count for this job when notes used a higher sequence. */
export function bumpJobCount(counts: Record<string, number>, job: string, notes: string): Record<string, number> | null {
  const trimmedJob = job.trim();
  const used = sequenceUsedInNotes(trimmedJob, notes);
  if (used == null || used <= (counts[trimmedJob] || 0)) return null;
  return { ...counts, [trimmedJob]: used };
}

export function readSavedCodes(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

export function writeSavedCodes(codes: string[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(codes));
  } catch {
    /* the stamp still prints if the browser will not store the list */
  }
}

export function readJobCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [job, count] of Object.entries(parsed)) {
      const value = typeof count === "number" ? count : Number.parseInt(String(count), 10);
      if (job.trim() && Number.isFinite(value)) counts[job] = value;
    }
    return counts;
  } catch {
    return {};
  }
}

export function readLastStamp(): LastStampSettings | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastStampSettings>;
    if (!parsed || typeof parsed !== "object") return null;
    const gl = typeof parsed.gl === "string" && AP_GL_OPTIONS.some((option) => option.label === parsed.gl)
      ? parsed.gl
      : DEFAULT_AP_GL;
    const costCode = typeof parsed.costCode === "string" && parsed.costCode.trim()
      ? parsed.costCode
      : DEFAULT_AP_COST_CODES[0] ?? "";
    return {
      gl,
      costCode,
      customCode: typeof parsed.customCode === "string" ? parsed.customCode : "",
      rememberCode: parsed.rememberCode === true,
      approved: typeof parsed.approved === "string" ? parsed.approved : "",
    };
  } catch {
    return null;
  }
}

export function writeLastStamp(settings: LastStampSettings) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(settings));
  } catch {
    /* the next stamp can still use the defaults on screen */
  }
}

export function writeJobCounts(counts: Record<string, number>) {
  try {
    localStorage.setItem(COUNT_KEY, JSON.stringify(counts));
  } catch {
    /* the next note can still be typed by hand */
  }
}
