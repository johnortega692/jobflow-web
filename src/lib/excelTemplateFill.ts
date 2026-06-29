import {
  resolveExcelFieldValue,
  type ExcelPasteExtras,
  type ExcelTemplateMapping,
} from "./excelPasteHelper";
import { patchXlsxCellValues } from "./xlsxSurgicalFill";
import type { ProjectForm } from "../types/database";

function topLeftCell(addr: string): string {
  return addr.split(":")[0]?.replace(/\$/g, "").toUpperCase() ?? addr.toUpperCase();
}

export type FillTemplateResult = {
  bytes: Uint8Array;
  filledCount: number;
  sheetName: string;
};

/**
 * Fill an Excel template in memory — values only. Patches worksheet XML inside the
 * zip so tables, AutoFilter, fonts, borders, and merges stay exactly as in the template.
 */
export async function fillExcelTemplateBuffer(
  templateBytes: ArrayBuffer,
  mappings: ExcelTemplateMapping[],
  project: ProjectForm,
  extras: ExcelPasteExtras = {},
): Promise<FillTemplateResult> {
  const cellValues: Record<string, string> = {};
  let filledCount = 0;

  for (const m of mappings) {
    const value = resolveExcelFieldValue(m.field, project, extras);
    if (!value.trim()) continue;
    cellValues[topLeftCell(m.named_range)] = value;
    filledCount += 1;
  }

  const { bytes, sheetName } = await patchXlsxCellValues(templateBytes, cellValues);
  return { bytes, filledCount, sheetName };
}

export function downloadFilledTemplate(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function filledTemplateFilename(
  uploadedName: string,
  project: ProjectForm,
  rename?: { enabled?: boolean; find?: string; replace_field?: string },
  extras: ExcelPasteExtras = {},
): string {
  let name = uploadedName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  if (rename?.enabled && rename.find) {
    const replacement = resolveExcelFieldValue(rename.replace_field ?? "job_number", project, extras);
    if (replacement) name = name.replace(rename.find, replacement);
  }
  const ext = uploadedName.match(/\.(xlsx|xlsm|xls)$/i)?.[0] ?? ".xlsx";
  return `${name} (filled)${ext}`;
}
