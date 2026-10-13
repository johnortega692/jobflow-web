/**
 * Read a GC schedule (Excel, CSV, PDF, or P6 .xer) and keep paint / wallcovering activities.
 */

import * as XLSX from "xlsx";
import { parseFlexibleDate } from "./dateInputUtils";

export type GcTrade = "paint" | "wallcovering";

export type GcScheduleActivity = {
  key: string;
  activityId: string;
  name: string;
  trade: GcTrade;
  /** Name also mentions paint when the row is classified as wallcovering. */
  alsoPaint: boolean;
  startIso: string | null;
  finishIso: string | null;
  /** Labor-hour suggestion from an hours column, or duration × 8. 0 when unknown. */
  suggestedHours: number;
  durationLabel: string;
};

export type GcScheduleParseResult = {
  activities: GcScheduleActivity[];
  scanned: number;
  sourceLabel: string;
};

const PAINT_RE = /\b(paint(?:ing|ers?|ed)?|primer|prime\s+coat|finish\s+coat|coatings?)\b|\b09\s*91(?:\s*\d{2})?\b/i;
const WALL_RE =
  /\b(wall\s*coverings?|wallcovering|wall\s*paper|wallpaper|vinyl\s+wall|wall\s+vinyl|fabric\s+wall|wall\s+fabric)\b|\b09\s*72(?:\s*\d{2})?\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function classifyGcActivityName(name: string): { trade: GcTrade; alsoPaint: boolean } | null {
  const wall = WALL_RE.test(name);
  const paint = PAINT_RE.test(name);
  if (!wall && !paint) return null;
  if (wall) return { trade: "wallcovering", alsoPaint: paint };
  return { trade: "paint", alsoPaint: false };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoFromParts(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function dateToIso(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const useUtc = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
  const y = useUtc ? value.getUTCFullYear() : value.getFullYear();
  const m = (useUtc ? value.getUTCMonth() : value.getMonth()) + 1;
  const d = useUtc ? value.getUTCDate() : value.getDate();
  return isoFromParts(y, m, d);
}

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed?.y) return null;
  return isoFromParts(parsed.y, parsed.m, parsed.d);
}

export function gcCellToIso(value: unknown): string | null {
  if (value instanceof Date) return dateToIso(value);
  if (typeof value === "number") return excelSerialToIso(value);
  const text = String(value ?? "").trim();
  if (!text) return null;
  const dmon = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})/);
  if (dmon) {
    const mon = MONTHS.findIndex((m) => dmon[2]!.toLowerCase().startsWith(m));
    if (mon >= 0) {
      let y = Number(dmon[3]);
      if (y < 100) y += 2000;
      return isoFromParts(y, mon + 1, Number(dmon[1]));
    }
  }
  const isoLead = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLead) return isoFromParts(Number(isoLead[1]), Number(isoLead[2]), Number(isoLead[3]));
  const mdy = text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (mdy) {
    let y = Number(mdy[3]);
    if (y < 100) y += 2000;
    return isoFromParts(y, Number(mdy[1]), Number(mdy[2]));
  }
  const dashed = text.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (dashed) {
    let y = Number(dashed[3]);
    if (y < 100) y += 2000;
    const iso = isoFromParts(y, Number(dashed[1]), Number(dashed[2]));
    if (iso) return iso;
  }
  const flex = parseFlexibleDate(text);
  if (!flex) return null;
  return isoFromParts(flex.getFullYear(), flex.getMonth() + 1, flex.getDate());
}

function textCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function headerLabel(value: unknown): string {
  return textCell(value).toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function nameScore(label: string): number {
  if (!label || /(?:^|\s)id$/.test(label) || label.includes(" id")) return 0;
  if (label === "activity name" || label === "task name") return 5;
  if (label.endsWith("activity name") || label.endsWith("task name")) return 4;
  if (label === "activity" || label === "task") return 3;
  if (label === "description") return 2;
  if (label === "name") return 1;
  return 0;
}

function startScore(label: string): number {
  if (!label || label.includes("finish") || label.includes("end") || label.includes("float")) return 0;
  if (label === "early start" || label === "early start date") return 6;
  if (label === "target start" || label === "target start date" || label === "planned start" || label === "planned start date") {
    return 5;
  }
  if (label === "start" || label === "start date") return 4;
  if (label.includes("start") && !label.includes("constraint")) return 3;
  return 0;
}

function finishScore(label: string): number {
  if (!label || label.includes("float") || label.includes("start")) return 0;
  if (label === "early finish" || label === "early finish date" || label === "early end" || label === "early end date") {
    return 6;
  }
  if (
    label === "target end" ||
    label === "target end date" ||
    label === "target finish" ||
    label === "planned finish" ||
    label === "planned finish date"
  ) {
    return 5;
  }
  if (label === "finish" || label === "finish date" || label === "end" || label === "end date") return 4;
  if ((label.includes("finish") || label.includes("end")) && !label.includes("constraint")) return 3;
  return 0;
}

function hoursScore(label: string): number {
  if (!label || label.includes("float") || label.includes("duration") || label.includes("drtn")) return 0;
  if (label === "labor hours" || label === "manhours" || label === "man hours" || label === "manpower hours") return 5;
  if (label === "budget hours" || label === "budgeted hours") return 4;
  if (label === "hours" || label === "remaining hours") return 3;
  if (label.includes("hour") && (label.includes("labor") || label.includes("man"))) return 4;
  return 0;
}

function durationScore(label: string): number {
  if (!label) return 0;
  if (label.includes("hour") && !label.includes("duration") && !label.includes("drtn")) return 0;
  if (label === "original duration" || label === "target duration") return 5;
  if (label === "remaining duration") return 4;
  if (label === "duration") return 3;
  if (label.includes("duration") || label.includes("drtn")) return 2;
  return 0;
}

function idScore(label: string): number {
  if (label === "activity id" || label === "task id" || label === "activity code" || label === "task code") return 4;
  if (label === "id" || label === "code") return 1;
  return 0;
}

function bestColumn(header: string[], score: (label: string) => number): number {
  let idx = -1;
  let best = 0;
  header.forEach((label, i) => {
    const s = score(label);
    if (s > best) {
      best = s;
      idx = i;
    }
  });
  return idx;
}

type DurationRead = { amount: number; unit: "days" | "hours" };

function parseDuration(value: unknown, headerLooksLikeHours: boolean): DurationRead | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 20000) {
    return { amount: value, unit: headerLooksLikeHours ? "hours" : "days" };
  }
  const text = textCell(value).toLowerCase();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unitToken = match[2] ?? "";
  if (unitToken.startsWith("h")) return { amount, unit: "hours" };
  if (unitToken.startsWith("d")) return { amount, unit: "days" };
  return { amount, unit: headerLooksLikeHours ? "hours" : "days" };
}

function numberHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100000) return value;
  const text = textCell(value).replace(/,/g, "");
  if (!text || text === "-" || text === "—") return null;
  const n = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function suggestionFrom(hoursCell: unknown, durationCell: unknown, durationHeader: string): {
  suggestedHours: number;
  durationLabel: string;
} {
  const explicit = numberHours(hoursCell);
  if (explicit != null) {
    return { suggestedHours: Math.round(explicit * 10) / 10, durationLabel: "" };
  }
  const headerHours = durationHeader.includes("hour") || durationHeader.includes("hr");
  const dur = parseDuration(durationCell, headerHours);
  if (!dur) return { suggestedHours: 0, durationLabel: "" };
  if (dur.unit === "hours") {
    const hours = Math.round(dur.amount * 10) / 10;
    return { suggestedHours: hours, durationLabel: `${hours} schedule hours` };
  }
  const days = Math.round(dur.amount * 10) / 10;
  return { suggestedHours: Math.round(days * 8 * 10) / 10, durationLabel: `${days} days` };
}

type BuiltRow = {
  activityId: string;
  name: string;
  startIso: string | null;
  finishIso: string | null;
  suggestedHours: number;
  durationLabel: string;
};

function toActivities(rows: BuiltRow[], sourceLabel: string, scanned: number): GcScheduleParseResult {
  const activities: GcScheduleActivity[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const classified = classifyGcActivityName(row.name);
    if (!classified) return;
    const dedupe = `${classified.trade}|${row.name.toLowerCase()}|${row.startIso ?? ""}|${row.finishIso ?? ""}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    activities.push({
      key: `${index}:${row.activityId}:${row.name}`,
      activityId: row.activityId,
      name: row.name,
      trade: classified.trade,
      alsoPaint: classified.alsoPaint,
      startIso: row.startIso,
      finishIso: row.finishIso,
      suggestedHours: row.suggestedHours,
      durationLabel: row.durationLabel,
    });
  });
  return { activities, scanned, sourceLabel };
}

export type GcScheduleAiRow = {
  id?: string;
  name?: string;
  trade?: string;
  start?: string;
  finish?: string;
  hours?: number | string;
  duration?: string;
};

/** Activities returned by the scan reader. Keeps a row when the model marks it paint or wallcovering. */
export function gcScheduleFromAiRows(rows: GcScheduleAiRow[], sourceLabel: string, scanned: number): GcScheduleParseResult {
  const activities: GcScheduleActivity[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 3) return;
    const classified = classifyGcActivityName(name);
    const hinted = row.trade === "wallcovering" ? "wallcovering" : row.trade === "paint" ? "paint" : null;
    if (!classified && !hinted) return;
    const trade = classified?.trade ?? hinted!;
    const startIso = gcCellToIso(row.start);
    const finishIso = gcCellToIso(row.finish) ?? startIso;
    const suggestion = suggestionFrom(row.hours, row.duration ?? "", "duration");
    const dedupe = `${trade}|${name.toLowerCase()}|${startIso ?? ""}|${finishIso ?? ""}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    activities.push({
      key: `ai:${index}:${String(row.id ?? "")}:${name}`,
      activityId: String(row.id ?? "").trim(),
      name,
      trade,
      alsoPaint: classified?.alsoPaint ?? false,
      startIso,
      finishIso,
      suggestedHours: suggestion.suggestedHours,
      durationLabel: suggestion.durationLabel,
    });
  });
  return { activities, scanned, sourceLabel };
}

/** Header-row check used by the PDF importer when it rebuilds a table. */
export function rowLooksLikeGcHeader(cells: string[]): boolean {
  const labels = cells.map(headerLabel);
  return labels.some((label) => nameScore(label) > 0) && labels.some((label) => startScore(label) > 0 || finishScore(label) > 0);
}

/** Higher when adjacent PDF words form a real column title ("Early" + "Start"). */
export function gcSchedulePhraseScore(label: string): number {
  const header = headerLabel(label);
  return nameScore(header) + startScore(header) + finishScore(header) + hoursScore(header) + durationScore(header) + idScore(header);
}

export function parseGcScheduleTable(rows: unknown[][], sourceLabel: string): GcScheduleParseResult | null {
  return parseSheet(rows, sourceLabel);
}

function parseSheet(rows: unknown[][], sourceLabel: string): GcScheduleParseResult | null {
  let headerIndex = -1;
  let header: string[] = [];
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const labels = (rows[i] ?? []).map(headerLabel);
    const hasName = labels.some((label) => nameScore(label) > 0);
    const hasDate = labels.some((label) => startScore(label) > 0 || finishScore(label) > 0);
    if (hasName && hasDate) {
      headerIndex = i;
      header = labels;
      break;
    }
  }
  if (headerIndex < 0) return null;

  const nameCol = bestColumn(header, nameScore);
  const startCol = bestColumn(header, startScore);
  const finishCol = bestColumn(header, finishScore);
  const hoursCol = bestColumn(header, hoursScore);
  const durationCol = bestColumn(header, durationScore);
  const idCol = bestColumn(header, idScore);
  const durationHeader = durationCol >= 0 ? header[durationCol] ?? "" : "";

  const built: BuiltRow[] = [];
  let scanned = 0;
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = textCell(row[nameCol]);
    if (!name) continue;
    scanned += 1;
    const suggestion = suggestionFrom(
      hoursCol >= 0 ? row[hoursCol] : null,
      durationCol >= 0 ? row[durationCol] : null,
      durationHeader,
    );
    built.push({
      activityId: idCol >= 0 ? textCell(row[idCol]) : "",
      name,
      startIso: startCol >= 0 ? gcCellToIso(row[startCol]) : null,
      finishIso: finishCol >= 0 ? gcCellToIso(row[finishCol]) : null,
      suggestedHours: suggestion.suggestedHours,
      durationLabel: suggestion.durationLabel,
    });
  }
  return toActivities(built, sourceLabel, scanned);
}

function parseWorkbook(buffer: ArrayBuffer, fileName: string): GcScheduleParseResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  let best: GcScheduleParseResult | null = null;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
    const parsed = parseSheet(rows, sheetName || fileName);
    if (!parsed) continue;
    if (!best || parsed.activities.length > best.activities.length) best = parsed;
  }
  if (!best) {
    throw new Error(
      "Could not find activity name and date columns. Export the GC schedule to Excel with Activity Name and Start.",
    );
  }
  return best;
}

function xerField(headers: string[], cells: string[], name: string): string {
  const idx = headers.indexOf(name);
  return idx >= 0 ? (cells[idx] ?? "").trim() : "";
}

function parseXer(text: string, fileName: string): GcScheduleParseResult {
  const lines = text.split(/\r?\n/);
  let inTask = false;
  let headers: string[] = [];
  const built: BuiltRow[] = [];
  let scanned = 0;
  for (const line of lines) {
    if (line.startsWith("%T")) {
      inTask = line.split("\t")[1]?.trim() === "TASK";
      headers = [];
      continue;
    }
    if (!inTask) continue;
    if (line.startsWith("%F")) {
      headers = line.split("\t").slice(1).map((h) => h.trim().toLowerCase());
      continue;
    }
    if (!line.startsWith("%R") || headers.length === 0) continue;
    const cells = line.split("\t").slice(1);
    const name = xerField(headers, cells, "task_name");
    if (!name) continue;
    scanned += 1;
    const start =
      xerField(headers, cells, "early_start_date") ||
      xerField(headers, cells, "target_start_date") ||
      xerField(headers, cells, "act_start_date");
    const finish =
      xerField(headers, cells, "early_end_date") ||
      xerField(headers, cells, "target_end_date") ||
      xerField(headers, cells, "act_end_date");
    const durationHours = Number(xerField(headers, cells, "target_drtn_hr_cnt"));
    const suggestion =
      Number.isFinite(durationHours) && durationHours > 0
        ? suggestionFrom(null, durationHours, "hours")
        : { suggestedHours: 0, durationLabel: "" };
    built.push({
      activityId: xerField(headers, cells, "task_code"),
      name,
      startIso: gcCellToIso(start),
      finishIso: gcCellToIso(finish),
      suggestedHours: suggestion.suggestedHours,
      durationLabel: suggestion.durationLabel,
    });
  }
  if (!headers.length && scanned === 0 && built.length === 0) {
    throw new Error("This P6 file has no TASK activities.");
  }
  return toActivities(built, fileName || "P6", scanned);
}

export async function parseGcScheduleFile(file: File): Promise<GcScheduleParseResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder().decode(bytes.slice(0, 400));
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || head.startsWith("%PDF")) {
    const { parseGcSchedulePdf } = await import("./gcSchedulePdf");
    return parseGcSchedulePdf(buffer, file.name);
  }
  if (lower.endsWith(".xer") || head.startsWith("ERMHDR") || head.includes("%T\tTASK") || head.includes("%T TASK")) {
    return parseXer(new TextDecoder().decode(bytes), file.name);
  }
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(lower) && !head.startsWith("PK")) {
    throw new Error("Use an Excel file (.xlsx, .xls), a PDF, CSV, or a P6 schedule (.xer).");
  }
  return parseWorkbook(buffer, file.name);
}
