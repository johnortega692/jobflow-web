import type { TransmittalData, TransmittalHistoryEntry } from "../types/tradeDocuments";
import type { TransmittalDownloadResult } from "./transmittalCombine";
import { paintSheetLabel } from "./transmittalHelpers";

export function buildTransmittalHistoryEntry(
  transmittal: TransmittalData,
  jobNumber: string,
  jobName: string,
  pdfResult: TransmittalDownloadResult,
): TransmittalHistoryEntry {
  const enclosure_count = transmittal.enclosures.filter((e) => e.included && e.description.trim()).length;
  return {
    id: crypto.randomUUID(),
    transmittal_number: transmittal.transmittal_number,
    date: transmittal.date,
    subject: transmittal.subject,
    job_number: jobNumber.trim(),
    job_name: jobName.trim(),
    contract: transmittal.contract,
    generated_at: new Date().toISOString(),
    combined: pdfResult.combined,
    appended_sheets: pdfResult.appendedSheets,
    include_paint_sheet: transmittal.include_paint_sheet,
    include_wc_sheet: transmittal.include_wc_sheet,
    include_frp_sheet: transmittal.include_frp_sheet,
    paint_submittal_nums: [...transmittal.paint_submittal_nums],
    wc_submittal_nums: [...transmittal.wc_submittal_nums],
    frp_submittal_nums: [...transmittal.frp_submittal_nums],
    enclosure_count,
    missing_warnings: [...pdfResult.missing],
    snapshot: structuredClone(transmittal),
  };
}

export function addTransmittalHistoryEntry(
  history: TransmittalHistoryEntry[],
  entry: TransmittalHistoryEntry,
): TransmittalHistoryEntry[] {
  return [entry, ...history].sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

export function formatTransmittalHistoryLabel(entry: TransmittalHistoryEntry): string {
  const when = new Date(entry.generated_at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const sheets: string[] = [];
  if (entry.include_paint_sheet && entry.paint_submittal_nums.length) {
    sheets.push(`Paint ${paintSheetLabel(entry.paint_submittal_nums)}`);
  }
  if (entry.include_wc_sheet && entry.wc_submittal_nums.length) {
    sheets.push(`WC ${paintSheetLabel(entry.wc_submittal_nums)}`);
  }
  if (entry.include_frp_sheet && entry.frp_submittal_nums.length) {
    sheets.push(`FRP ${paintSheetLabel(entry.frp_submittal_nums)}`);
  }
  const sheetPart = sheets.length ? ` · ${sheets.join(", ")}` : "";
  const combinedPart = entry.combined ? " · Combined PDF" : "";
  return `${entry.transmittal_number} · ${when}${sheetPart}${combinedPart}`;
}

export function formatTransmittalHistoryDetail(entry: TransmittalHistoryEntry): string {
  const lines = [
    `Subject: ${entry.subject || "—"}`,
    `Job: ${entry.job_number} — ${entry.job_name}`,
    `Enclosures: ${entry.enclosure_count}`,
  ];
  if (entry.combined && entry.appended_sheets > 0) {
    lines.push(`Trade sheets appended: ${entry.appended_sheets}`);
  }
  if (entry.missing_warnings.length) {
    lines.push(`Warnings: ${entry.missing_warnings.join(" ")}`);
  }
  return lines.join("\n");
}
