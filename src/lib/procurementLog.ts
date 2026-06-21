import type { WcTrackerLineState } from "../types/fieldTracker";

export type ProcurementLogRow = {
  finish: string;
  product: string;
  leadTime: string;
  approvalReceived: string;
  dateOrdered: string;
  shipDate: string;
  dateReceivedTracking: string;
  notes: string;
};

const INTERNAL_TRACKING_PRODUCT = "APS Track and Infill";

function formatCell(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    }
  }
  return v;
}

export function buildProcurementNotesFromLine(line: WcTrackerLineState): string {
  const autoNotes: string[] = [];
  if (line.shops) autoNotes.push("Shops needed for approval");
  if (line.fieldMeasurement) autoNotes.push("Field measurements needed before ordering");
  const existing = line.notesDelivered.trim();
  if (autoNotes.length === 0) return existing;
  if (!existing) return autoNotes.join("; ");
  return `${autoNotes.join("; ")} | ${existing}`;
}

export function buildProcurementLogRowsFromLines(lines: WcTrackerLineState[]): ProcurementLogRow[] {
  return lines
    .filter((line) => line.wallcoveringName.trim() !== INTERNAL_TRACKING_PRODUCT)
    .map((line) => ({
      finish: line.label.trim(),
      product: line.wallcoveringName.trim(),
      leadTime: line.leadTime.trim(),
      approvalReceived: formatCell(line.approvalReceived),
      dateOrdered: formatCell(line.dateOrdered),
      shipDate: formatCell(line.shipDate),
      dateReceivedTracking: formatCell(line.tracking),
      notes: buildProcurementNotesFromLine(line),
    }));
}

/** @deprecated Use buildProcurementLogRowsFromLines — sheet row adapter for one-time import. */
export function buildProcurementLogRows(rows: import("./wcTrackerSync").WcTrackerRow[]): ProcurementLogRow[] {
  return rows
    .filter((row) => row.wallcoveringName.trim() !== INTERNAL_TRACKING_PRODUCT)
    .map((row) => ({
      finish: row.label.trim(),
      product: row.wallcoveringName.trim(),
      leadTime: row.leadTime.trim(),
      approvalReceived: formatCell(row.approvalReceived),
      dateOrdered: formatCell(row.dateOrdered),
      shipDate: formatCell(row.shipDate),
      dateReceivedTracking: formatCell(row.tracking),
      notes: buildProcurementNotes(row),
    }));
}

export function buildProcurementNotes(row: import("./wcTrackerSync").WcTrackerRow): string {
  const autoNotes: string[] = [];
  if (row.shops) autoNotes.push("Shops needed for approval");
  if (row.fieldMeasurement) autoNotes.push("Field measurements needed before ordering");
  const existing = row.notesDelivered.trim();
  if (autoNotes.length === 0) return existing;
  if (!existing) return autoNotes.join("; ");
  return `${autoNotes.join("; ")} | ${existing}`;
}
