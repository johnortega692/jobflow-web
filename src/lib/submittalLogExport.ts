import * as XLSX from "xlsx";
import { TRANSMITTAL_CONTRACT_LABELS } from "./jobInfo";
import { formatLineNumberDisplay, scopeToContract } from "./submittalLogHelpers";
import type { SubmittalLogRow } from "../types/submittalLog";

export type SubmittalLogExportOptions = {
  includeContractColumn?: boolean;
  exportLabel?: string;
};

export function exportSubmittalLogExcel(
  rows: SubmittalLogRow[],
  jobNumber: string,
  jobName: string,
  options?: SubmittalLogExportOptions,
): void {
  const sheetRows = rows.map((r) => {
    const base = {
      "#": formatLineNumberDisplay(r.line_number),
      SPEC: r.spec,
      SCOPE: r.scope,
      SECTION: r.section,
      SUBMITTAL: r.submittal_type,
      SUBMIT: r.submit_date,
      RETURN: r.return_date,
      RESULT: r.result,
      Status: r.status,
      "Trans #": r.transmittal_number,
      NOTES: r.notes,
    };
    if (!options?.includeContractColumn) return base;
    const contract = scopeToContract(r.scope) ?? "paint";
    return {
      Contract: TRANSMITTAL_CONTRACT_LABELS[contract],
      ...base,
    };
  });

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Submittal Log");

  const metaRows: (string | undefined)[][] = [
    ["Job Number", jobNumber],
    ["Job Name", jobName],
  ];
  if (options?.exportLabel) {
    metaRows.push(["Contract", options.exportLabel]);
  }
  metaRows.push(["Exported", new Date().toLocaleString()]);
  const meta = XLSX.utils.aoa_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, meta, "Info");

  const safeJob = (jobNumber || "job").replace(/[^\w.-]+/g, "_");
  XLSX.writeFile(wb, `${safeJob} ICBI SUBMITTAL Log.xlsx`);
}
