/**
 * Import an Initial PM Budget workbook.
 * Row 9 is the frozen header. Budget rows start on the next row:
 * A work item (cost code name), B cost code, C cost class, D hours, E amount, F notes.
 */

import * as XLSX from "xlsx";
import { codeType, fmtCell, resolveCostClass } from "./budgetMakerCore.js";
import {
  TYPE_DEFAULT_CLASS,
  type BudgetBucket,
  type BudgetLibrary,
  type BudgetScanLine,
  type CostCodeRecord,
} from "../types/budgetMaker.js";

export type ImportedBudgetSheet = {
  lines: BudgetScanLine[];
  buckets: BudgetBucket[];
};

const HEADER_ROW_INDEX = 8;
const STOP_LABELS = new Set(["budget total", "contract value", "profit", "grand total"]);

function textCell(value: unknown): string {
  return fmtCell(value).trim().replace(/\s+/g, " ");
}

function codeCell(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    const asInt = Math.round(value);
    if (Math.abs(value - asInt) < 1e-6) return String(asInt);
    return String(value);
  }
  return fmtCell(value).trim();
}

function numberCell(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
  }
  const text = String(value).trim();
  if (!text || text === "-" || text === "—") return null;
  const n = parseFloat(text.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function rowLooksLikeHeader(row: unknown[] | undefined): boolean {
  const cells = (row ?? []).map((cell) => textCell(cell).toLowerCase());
  const hasName = cells.some((cell) => cell === "work item" || cell === "cost code name");
  const hasCode = cells.some((cell) => cell === "cost code");
  const hasValue = cells.some((cell) => cell === "amount" || cell === "hours" || cell === "icbi hours");
  return (hasName || hasCode) && hasValue;
}

function findHeaderIndex(rows: unknown[][]): number {
  if (rowLooksLikeHeader(rows[HEADER_ROW_INDEX])) return HEADER_ROW_INDEX;
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    if (rowLooksLikeHeader(rows[i])) return i;
  }
  return -1;
}

function takeColumn(
  header: unknown[],
  used: Set<number>,
  match: (label: string) => boolean,
  fallback: number,
): number {
  const idx = header.findIndex((cell, i) => !used.has(i) && match(textCell(cell).toLowerCase()));
  const chosen = idx >= 0 ? idx : !used.has(fallback) ? fallback : -1;
  if (chosen >= 0) used.add(chosen);
  return chosen;
}

function notesText(row: unknown[], notesCol: number, commentsCol: number): string {
  const notes = notesCol >= 0 ? textCell(row[notesCol]) : "";
  const comments = commentsCol >= 0 ? textCell(row[commentsCol]) : "";
  if (notes && comments && notes !== comments) return `${notes} · ${comments}`;
  return notes || comments;
}

function isStopRow(row: unknown[], columns: number[]): boolean {
  return columns.some((index) => {
    if (index < 0) return false;
    return STOP_LABELS.has(textCell(row[index]).toLowerCase());
  });
}

function codesFor(lib: BudgetLibrary, code: string): CostCodeRecord[] {
  return lib.cost_codes.filter((rec) => fmtCell(rec.cost_code) === code);
}

function inferCostClass(lib: BudgetLibrary, code: string): string {
  const classes = [
    ...new Set(
      codesFor(lib, code)
        .map((rec) => {
          const raw = fmtCell(rec.cost_class);
          if (/^\d+$/.test(raw)) return raw;
          return resolveCostClass(rec, null);
        })
        .filter(Boolean),
    ),
  ];
  return classes.length === 1 ? classes[0] : "";
}

function matchCode(lib: BudgetLibrary, code: string, costClass: string): CostCodeRecord | undefined {
  const matches = codesFor(lib, code);
  if (!matches.length) return undefined;
  if (costClass) {
    return matches.find((rec) => fmtCell(rec.cost_class) === costClass) ?? (matches.length === 1 ? matches[0] : undefined);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function categoryFor(costClass: string, templateType: string): string {
  const type = templateType.toUpperCase();
  if (type === "LABOR" || costClass === TYPE_DEFAULT_CLASS.LABOR) return "Labor";
  if (type === "MATERIALS" || costClass === TYPE_DEFAULT_CLASS.MATERIALS) return "Material";
  if (type === "SUBCONTRACTOR" || costClass === TYPE_DEFAULT_CLASS.SUBCONTRACTOR) return "Subcontractor";
  if (
    type === "EQUIPMENT" ||
    type === "EQUIPMENT_RENTED" ||
    costClass === TYPE_DEFAULT_CLASS.EQUIPMENT ||
    costClass === TYPE_DEFAULT_CLASS.EQUIPMENT_RENTED
  ) {
    return "Equipment";
  }
  if (type === "MISC" || costClass === TYPE_DEFAULT_CLASS.MISC) return "Other";
  return "";
}

function pickSheetName(names: string[]): string {
  return names.find((name) => /initial pm budget/i.test(name)) ?? names[0] ?? "";
}

export function parseBudgetExcel(data: ArrayBuffer, lib: BudgetLibrary): ImportedBudgetSheet {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = pickSheetName(wb.SheetNames);
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error("The Excel file has no sheets to import.");
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error(
      "No budget header found. Row 9 should be Work Item, Cost Code, Cost Class, Hours, Amount, and Notes, with items on the rows below.",
    );
  }

  const header = rows[headerIndex] ?? [];
  const used = new Set<number>();
  const nameCol = takeColumn(
    header,
    used,
    (label) => label === "work item" || label === "cost code name" || label === "description",
    0,
  );
  const codeCol = takeColumn(header, used, (label) => label === "cost code", 1);
  const classCol = takeColumn(header, used, (label) => label === "cost class" || label === "class", 2);
  const hoursCol = takeColumn(header, used, (label) => label === "hours" || label === "icbi hours" || label.endsWith(" hours"), 3);
  const amountCol = takeColumn(header, used, (label) => label === "amount", 4);
  const notesCol = takeColumn(header, used, (label) => label === "notes", 5);
  const commentsCol = takeColumn(header, used, (label) => label === "comments" || label === "comment", 6);

  const lines: BudgetScanLine[] = [];
  const buckets: BudgetBucket[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isStopRow(row, [nameCol, codeCol, classCol])) break;

    const name = nameCol >= 0 ? textCell(row[nameCol]) : "";
    const code = codeCol >= 0 ? codeCell(row[codeCol]) : "";
    let costClass = classCol >= 0 ? codeCell(row[classCol]) : "";
    const hours = hoursCol >= 0 ? numberCell(row[hoursCol]) : null;
    const amount = amountCol >= 0 ? numberCell(row[amountCol]) : null;
    const notes = notesText(row, notesCol, commentsCol);

    if (!name && !code && hours == null && amount == null && !notes) continue;
    if (!name && !code) continue;

    if (!costClass && code) costClass = inferCostClass(lib, code);
    const matched = code ? matchCode(lib, code, costClass) : undefined;
    const type = matched ? codeType(matched) : "";
    const templateType = type in TYPE_DEFAULT_CLASS ? type : "";

    const bucket: BudgetBucket = {
      cost_code: code,
      cost_class: costClass,
    };
    if (templateType) bucket.template_type = templateType;
    if (notes) bucket.notes = notes;
    if (name) bucket.work_item = name;
    buckets.push(bucket);

    lines.push({
      id: crypto.randomUUID(),
      Bucket: String(buckets.length - 1),
      Category: categoryFor(costClass, templateType),
      "PDF Code": code,
      Description: name || code,
      Quantity: null,
      UoM: "",
      "Unit Cost": null,
      Amount: amount,
      "Man Hours": hours,
      Notes: notes,
      Hidden: false,
    });
  }

  if (!lines.length) {
    throw new Error("No budget rows found below the header. Add work items on the rows after row 9.");
  }

  return { lines, buckets };
}

export async function parseBudgetExcelFile(file: ArrayBuffer, lib: BudgetLibrary): Promise<ImportedBudgetSheet> {
  return parseBudgetExcel(file, lib);
}
