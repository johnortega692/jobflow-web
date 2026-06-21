import { jobFullAddressOneLine } from "./jobInfo";
import { googleSheetsPost } from "./googleSheetsApi";

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

export async function updateManpowerSchedule(
  url: string | undefined,
  fields: {
    jobNumber: string;
    jobName: string;
    startDate: string;
    gcName: string;
    jobAddress: string;
    submittedBy: string;
  },
): Promise<GoogleSheetsSyncResult> {
  if (!url?.trim()) {
    return { ok: false, message: "Manpower Schedule URL not configured in Settings." };
  }
  const payload = {
    jobNumber: `${fields.jobNumber} ${fields.jobName}`.trim(),
    startDate: fields.startDate,
    gcName: fields.gcName,
    jobAddress: fields.jobAddress,
    submittedBy: fields.submittedBy,
  };
  const { status, json } = await googleSheetsPost(url, payload);
  if (status !== 200) {
    return { ok: false, message: `Manpower update failed (${status}).` };
  }
  const data = json as { status?: string; message?: string; sheetName?: string };
  if (data.status === "success") {
    return {
      ok: true,
      message: data.sheetName ? `Added to sheet: ${data.sheetName}` : "Added to Manpower Schedule.",
    };
  }
  return { ok: false, message: data.message ?? "Manpower update was not successful." };
}

export async function testManpowerUserName(
  url: string | undefined,
  userName: string,
): Promise<string> {
  if (!userName.trim()) return "Enter a user name first.";
  const result = await updateManpowerSchedule(url, {
    jobNumber: `TEST-${userName}-001`,
    jobName: "Test Job",
    startDate: "Test Date",
    gcName: "Test GC",
    jobAddress: "Test Address",
    submittedBy: userName.trim(),
  });
  return result.message;
}
