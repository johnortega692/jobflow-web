import * as XLSX from "xlsx";
import type { SubmittalLogRow } from "../types/submittalLog";
import { formatLineNumberDisplay } from "./submittalLogHelpers";

export function exportSubmittalLogExcel(
  rows: SubmittalLogRow[],
  jobNumber: string,
  jobName: string,
): void {
  const sheetRows = rows.map((r) => ({
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
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Submittal Log");

  const meta = XLSX.utils.aoa_to_sheet([
    ["Job Number", jobNumber],
    ["Job Name", jobName],
    ["Exported", new Date().toLocaleString()],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, "Info");

  const safeJob = (jobNumber || "job").replace(/[^\w.-]+/g, "_");
  XLSX.writeFile(wb, `${safeJob} ICBI SUBMITTAL Log.xlsx`);
}
