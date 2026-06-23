export { jobFullAddressOneLine } from "./jobInfo";

export function buildSheetJobInfo(jobNumber: string, jobName: string): string {
  const n = jobNumber.trim();
  const name = jobName.trim();
  if (n && name) return `${n} - ${name}`;
  return n || name;
}

export function buildSheetsClipboardRow(
  sheetJobInfo: string,
  startDate: string,
  gc: string,
  location: string,
): string {
  return [sheetJobInfo, startDate, gc, location].join("\t");
}

export type GoogleSheetsSyncResult = {
  ok: boolean;
  message: string;
};
