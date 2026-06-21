import * as XLSX from "xlsx";
import {
  loadEffectiveUserSettings,
  removeOrgSettingsKeys,
  saveOrgSettingsPatch,
  savePersonalUserSettingsPatch,
} from "./orgSettings";
import { ORG_SETTINGS_KEYS, pickPersonalSettingsPatch } from "./orgSettingsKeys";
import { supabase } from "./supabase";
import {
  fmtCell,
  bucketDisplay,
  buildSummaryRows,
  normalizeLibrary,
} from "./budgetMakerCore";
import type { BudgetLibrary, BudgetMakerData, BudgetScanLine } from "../types/budgetMaker";

function exportFilename(stem: string, extension: string, jobName = ""): string {
  const ext = extension.replace(/^\./, "");
  const job = jobName.trim().replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
  return job ? `${job}-${stem}.${ext}` : `${stem}.${ext}`;
}
import { defaultBudgetLibrary } from "../types/budgetMaker";
import type { Json } from "../types/database";

const LIB_KEY = "budget_library";
const ORG_KEY_SET = new Set<string>(ORG_SETTINGS_KEYS);

/** Merged org + personal settings (use for reads across the app). */
export async function loadRawUserSettings(userId: string): Promise<Record<string, unknown>> {
  return loadEffectiveUserSettings(userId);
}

export async function patchOrgSettings(
  userId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  return saveOrgSettingsPatch(patch, userId);
}

export async function patchUserSettings(
  userId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const personal = pickPersonalSettingsPatch(patch);
  if (!Object.keys(personal).length) return null;
  return savePersonalUserSettingsPatch(userId, personal);
}

export async function removeUserSettingsKeys(
  userId: string,
  keys: string[],
): Promise<string | null> {
  if (!keys.length) return null;
  const orgKeys = keys.filter((k) => ORG_KEY_SET.has(k));
  const personalKeys = keys.filter((k) => !ORG_KEY_SET.has(k));

  if (orgKeys.length) {
    const orgErr = await removeOrgSettingsKeys(orgKeys);
    if (orgErr) return orgErr;
  }

  if (!personalKeys.length) return null;

  const { data, error: loadErr } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (loadErr) return loadErr.message;

  const current =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
  const next = { ...current };
  for (const key of personalKeys) delete next[key];

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      settings: next as Json,
    },
    { onConflict: "user_id" },
  );
  return error?.message ?? null;
}

export async function loadBudgetLibrary(userId: string): Promise<BudgetLibrary> {
  const raw = await loadRawUserSettings(userId);
  return normalizeLibrary(raw[LIB_KEY] ?? defaultBudgetLibrary());
}

export async function saveBudgetLibrary(userId: string, lib: BudgetLibrary): Promise<string | null> {
  return patchUserSettings(userId, { [LIB_KEY]: lib });
}

function normalizeCol(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function mapColumns(
  rows: Record<string, unknown>[],
  aliases: Record<string, string[]>,
): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const byNorm = Object.fromEntries(headers.map((h) => [normalizeCol(h), h]));
  const rename: Record<string, string> = {};
  for (const [target, names] of Object.entries(aliases)) {
    for (const name of names) {
      const src = byNorm[normalizeCol(name)];
      if (src) {
        rename[src] = target;
        break;
      }
    }
  }
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [src, target] of Object.entries(rename)) {
      const v = row[src];
      out[target] = v == null || String(v).trim() === "" ? "" : String(v).trim();
    }
    for (const col of Object.values(rename)) {
      if (!(col in out)) out[col] = "";
    }
    return out;
  });
}

const COST_CODE_ALIASES = {
  gl_account: ["GL Account", "GL Accou", "GL Acct"],
  cost_code: ["Cost Code", "Cost Cod"],
  description: ["Description"],
  type: ["Type"],
  cost_class: ["Cost Class"],
};

const COST_CLASS_ALIASES = {
  gl_acct: ["GL Acct", "GL Account", "GL Accou"],
  cost_class: ["Cost Class"],
  description: ["Cost Class Description", "Description"],
};

function sheetToRows(wb: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
}

function findSheet(wb: XLSX.WorkBook, candidates: string[]): string {
  const byLower = Object.fromEntries(wb.SheetNames.map((n) => [n.toLowerCase(), n]));
  for (const c of candidates) {
    const hit = byLower[c.toLowerCase()];
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = wb.SheetNames.find((n) => n.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return wb.SheetNames[0];
}

export function importCostCodesFromTable(rows: Record<string, unknown>[]): BudgetLibrary["cost_codes"] {
  return mapColumns(rows, COST_CODE_ALIASES) as BudgetLibrary["cost_codes"];
}

export function importCostClassesFromTable(rows: Record<string, unknown>[]): BudgetLibrary["cost_classes"] {
  return mapColumns(rows, COST_CLASS_ALIASES) as BudgetLibrary["cost_classes"];
}

export async function importCostCodesFile(file: File): Promise<BudgetLibrary["cost_codes"]> {
  const buf = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(buf);
    const wb = XLSX.read(text, { type: "string" });
    return importCostCodesFromTable(sheetToRows(wb, wb.SheetNames[0]));
  }
  const wb = XLSX.read(buf, { type: "array" });
  return importCostCodesFromTable(sheetToRows(wb, wb.SheetNames[0]));
}

export async function importCostClassesFile(file: File): Promise<BudgetLibrary["cost_classes"]> {
  const buf = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(buf);
    const wb = XLSX.read(text, { type: "string" });
    return importCostClassesFromTable(sheetToRows(wb, wb.SheetNames[0]));
  }
  const wb = XLSX.read(buf, { type: "array" });
  return importCostClassesFromTable(sheetToRows(wb, wb.SheetNames[0]));
}

export async function importPainterWorkbook(
  file: File,
): Promise<{ cost_codes: BudgetLibrary["cost_codes"]; cost_classes: BudgetLibrary["cost_classes"] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const codesSheet = findSheet(wb, ["Painter Cost Codes", "Cost Codes", "cost codes"]);
  const classesSheet = findSheet(wb, ["cost classes", "Cost Classes"]);
  return {
    cost_codes: importCostCodesFromTable(sheetToRows(wb, codesSheet)),
    cost_classes: importCostClassesFromTable(sheetToRows(wb, classesSheet)),
  };
}

function lineExportRow(line: BudgetScanLine, buckets: BudgetMakerData["buckets"], lib: BudgetLibrary) {
  return {
    Bucket: bucketDisplay(line.Bucket, buckets, lib),
    Category: line.Category,
    "PDF Code": line["PDF Code"],
    Description: line.Description,
    Quantity: fmtCell(line.Quantity),
    UoM: line.UoM,
    "Unit Cost": fmtCell(line["Unit Cost"]),
    Amount: fmtCell(line.Amount),
    "Man Hours": fmtCell(line["Man Hours"]),
    Notes: line.Notes,
  };
}

export function downloadBudgetExcel(data: BudgetMakerData, lib: BudgetLibrary): void {
  const visible = data.lines.filter((l) => !l.Hidden);
  const linesRows = visible.map((l) => lineExportRow(l, data.buckets, lib));
  const totalsRows = buildSummaryRows(data.buckets, data.lines, lib, data.hide_zero_amounts).map((r) => ({
    "Work Item": r.workItem,
    "Cost Code": r.costCode,
    "Cost Class": r.costClass,
    "GL Acct": r.glAcct,
    Hours: r.hours,
    Amount: r.amount ? `$${r.amount.toFixed(2)}` : "",
    "%": r.pct,
    Notes: r.notes,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linesRows), "Scanned PDF Lines");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totalsRows), "Bucket Totals");
  const filename = exportFilename("budget", "xlsx", data.job_name);
  XLSX.writeFile(wb, filename);
}

export function downloadLinesCsv(data: BudgetMakerData, lib: BudgetLibrary): void {
  const visible = data.lines.filter((l) => !l.Hidden);
  const rows = visible.map((l) => lineExportRow(l, data.buckets, lib));
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  triggerDownload(csv, exportFilename("budget-lines", "csv", data.job_name), "text/csv");
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
