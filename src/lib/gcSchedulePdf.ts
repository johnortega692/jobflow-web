/**
 * Read a text-based GC schedule PDF. Columns are rebuilt from text positions.
 * Lines are scanned when the file has no Activity / Start header.
 */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import {
  classifyGcActivityName,
  gcSchedulePhraseScore,
  parseGcScheduleTable,
  rowLooksLikeGcHeader,
  type GcScheduleParseResult,
} from "./gcScheduleImport";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Frag = { x: number; y: number; str: string; end: number };

const DATE_TOKEN =
  /\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(?:\d{1,2}[-\s/](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s/]\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi;

const DURATION_TOKEN = /\b\d+(?:\.\d+)?\s*(?:d|days?|h|hrs?|hours?)\b/i;

/** MS Project printouts: `128 Painting - Prime 2d Thu 10/1/26 Fri 10/2/26`. */
const MSP_TASK =
  /^(\d+)\s+(.+?)\s+(\d+)\s*(d|days?)\??\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\/\d{2,4})\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\/\d{2,4})/i;

/** P6 printouts: `B20-1-1050 Prime/Paint Wall Patches 2 2 10-10-26 10-12-26`. */
const P6_TASK =
  /^([A-Za-z0-9][A-Za-z0-9.-]{2,})\s+(.+?)\s+(\d+)\s+\d+\s+(\d{1,2}-\d{1,2}-\d{2,4})\*?\s+(\d{1,2}-\d{1,2}-\d{2,4})\*?/;

function dateTokens(line: string): string[] {
  return [...line.matchAll(new RegExp(DATE_TOKEN.source, "gi"))].map((match) => match[0]);
}

function groupVisualRows(items: unknown[]): Frag[][] {
  const frags: Frag[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as { str?: string; transform?: number[]; width?: number };
    const str = item.str?.trim();
    if (!str || !item.transform || item.transform.length < 6) continue;
    const x = item.transform[4]!;
    const width = typeof item.width === "number" && item.width > 0 ? item.width : str.length * 5;
    frags.push({ x, y: item.transform[5]!, str, end: x + width });
  }
  frags.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Frag[][] = [];
  let group: Frag[] = [];
  let y0: number | null = null;
  for (const frag of frags) {
    if (y0 === null || Math.abs(frag.y - y0) <= 3) {
      group.push(frag);
      if (y0 === null) y0 = frag.y;
    } else {
      if (group.length) rows.push(group.sort((a, b) => a.x - b.x));
      group = [frag];
      y0 = frag.y;
    }
  }
  if (group.length) rows.push(group.sort((a, b) => a.x - b.x));
  return rows;
}

function mergeHeaderPhrases(frags: Frag[]): { x: number; label: string; end: number }[] {
  const phrases: { x: number; label: string; end: number }[] = [];
  for (const frag of frags) {
    const prev = phrases[phrases.length - 1];
    const gap = prev ? frag.x - prev.end : Infinity;
    const combined = prev ? `${prev.label} ${frag.str}`.replace(/\s+/g, " ").trim() : frag.str;
    if (
      prev &&
      gap <= 18 &&
      gcSchedulePhraseScore(combined) >= gcSchedulePhraseScore(prev.label) &&
      gcSchedulePhraseScore(combined) > 0
    ) {
      prev.label = combined;
      prev.end = Math.max(prev.end, frag.end);
      continue;
    }
    phrases.push({ x: frag.x, label: frag.str, end: frag.end });
  }
  return phrases;
}

function columnIndex(x: number, columns: { x: number }[]): number {
  for (let i = 0; i < columns.length; i++) {
    const next = columns[i + 1];
    if (!next) return i;
    const mid = (columns[i]!.x + next.x) / 2;
    if (x < mid) return i;
  }
  return 0;
}

function tableFromVisualRows(visualRows: Frag[][]): string[][] {
  let columns: { x: number; label: string }[] | null = null;
  const table: string[][] = [];
  for (const frags of visualRows) {
    const phrases = mergeHeaderPhrases(frags);
    if (rowLooksLikeGcHeader(phrases.map((phrase) => phrase.label))) {
      columns = phrases.map((phrase) => ({ x: phrase.x, label: phrase.label }));
      if (table.length === 0) table.push(columns.map((column) => column.label));
      continue;
    }
    if (!columns) continue;
    const cells = Array.from({ length: columns.length }, () => "");
    for (const frag of frags) {
      const idx = columnIndex(frag.x, columns);
      cells[idx] = `${cells[idx]} ${frag.str}`.trim();
    }
    if (cells.some(Boolean)) table.push(cells);
  }
  return table;
}

function activityNameFromLine(line: string): string {
  const duration = line.match(DURATION_TOKEN);
  let name = line;
  for (const date of dateTokens(line)) name = name.replace(date, " ");
  if (duration) name = name.replace(duration[0], " ");
  name = name.replace(/[|]+/g, " ").replace(/\s+/g, " ").trim();
  const stripped = name.replace(/^[A-Za-z]{0,4}-?\d{2,6}(?:\.\d+)*\s+/, "").trim();
  if (stripped && classifyGcActivityName(stripped)) return stripped;
  if (classifyGcActivityName(name)) return name;
  return "";
}

function mergeWrappedLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]?.trim() ?? "";
    if (!line) continue;
    if (classifyGcActivityName(line) && dateTokens(line).length === 0) {
      const next = lines[i + 1]?.trim() ?? "";
      if (next && dateTokens(next).length > 0 && !classifyGcActivityName(next)) {
        line = `${line} ${next}`;
        i += 1;
      }
    }
    merged.push(line);
  }
  return merged;
}

/** Fallback when a PDF has no column header: one activity per text line. */
export function parseGcScheduleLines(lines: string[], sourceLabel: string): GcScheduleParseResult {
  const rows: string[][] = [["Activity ID", "Activity Name", "Start", "Finish", "Duration"]];
  for (const line of mergeWrappedLines(lines)) {
    if (/^page\s+\d+/i.test(line) || line.length > 800) continue;
    const msp = line.match(MSP_TASK);
    if (msp) {
      const name = msp[2]!.replace(/\s+/g, " ").trim();
      if (!classifyGcActivityName(name)) continue;
      rows.push([msp[1]!, name, msp[5]!, msp[6]!, `${msp[3]} ${msp[4]}`]);
      continue;
    }
    const p6 = line.match(P6_TASK);
    if (p6) {
      const name = p6[2]!.replace(/\s+/g, " ").trim();
      if (!classifyGcActivityName(name)) continue;
      const days = Number(p6[3]);
      rows.push([p6[1]!, name, p6[4]!, p6[5]!, days === 1 ? "1 day" : `${p6[3]} days`]);
      continue;
    }
    const name = activityNameFromLine(line);
    if (!name || /^(activity|task)\s+name$/i.test(name)) continue;
    const dates = dateTokens(line);
    const duration = line.match(DURATION_TOKEN)?.[0] ?? "";
    const idMatch = line.match(/^([A-Za-z]{0,4}-?\d{2,6}(?:\.\d+)*)\s+/);
    rows.push([idMatch?.[1] ?? "", name, dates[0] ?? "", dates[1] ?? "", duration]);
  }
  return (
    parseGcScheduleTable(rows, sourceLabel) ?? {
      activities: [],
      scanned: lines.filter((line) => line.trim()).length,
      sourceLabel,
    }
  );
}

function datedActivityCount(result: GcScheduleParseResult | null): number {
  if (!result) return 0;
  return result.activities.filter((activity) => activity.startIso).length;
}

export async function parseGcSchedulePdf(buffer: ArrayBuffer, fileName: string): Promise<GcScheduleParseResult> {
  const doc = await getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const allLines: string[] = [];
  const visualRows: Frag[][] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = groupVisualRows(content.items);
    visualRows.push(...rows);
    for (const frags of rows) {
      const line = frags
        .map((frag) => frag.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) allLines.push(line);
    }
  }

  if (allLines.length === 0) {
    throw new Error(
      "This PDF has no selectable text. It looks like a scan or a DocuSign image.",
    );
  }

  const table = tableFromVisualRows(visualRows);
  const fromTable = table.length > 1 ? parseGcScheduleTable(table, fileName) : null;
  const fromLines = parseGcScheduleLines(allLines, fileName);
  if (fromTable && datedActivityCount(fromTable) > datedActivityCount(fromLines)) return fromTable;
  if (fromLines.activities.length > 0) return fromLines;
  return {
    activities: [],
    scanned: Math.max(fromTable?.scanned ?? 0, allLines.length),
    sourceLabel: fileName,
  };
}
