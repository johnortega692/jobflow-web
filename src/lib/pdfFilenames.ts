import { companyJobFilenamePrefix, companySpecSubmittalFilename, sanitizeFilenamePart } from "./sdsPacketPresets.js";
import { normalizeTransmittalNumber } from "./transmittalNumber.js";
import { IRONWOOD_SHORT_COMPANY_NAME } from "./displayCompanyName.js";
import type { TradeSubmittalType } from "../types/tradeDocuments.js";

/** Prefer job number over job name for download filenames (orders, RFI, etc.). */
export function projectFilenamePart(
  jobName: string,
  jobNumber: string,
  fallback = "Project",
): string {
  return sanitizeFilenamePart(jobNumber.trim() || jobName.trim() || fallback);
}

export function pdfTitleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

export function transmittalFilename(
  jobName: string,
  jobNumber: string,
  transmittalNumber: string | number | null | undefined,
): string {
  const projectPart = companyJobFilenamePrefix(jobNumber, jobName) || "Project";
  const numPart = sanitizeFilenamePart(normalizeTransmittalNumber(transmittalNumber));
  return `${projectPart} - Transmittal ${numPart}.pdf`;
}

/** Company format: `ICBI - 1151 - Crusoe 2nd Floor - 003 - 09 91 23 - Interior Painting.pdf` */
export function paintSubmittalFilename(
  jobName: string,
  jobNumber: string,
  submittalNumber: number,
  _submittalType: TradeSubmittalType,
  specSection?: string,
): string {
  const base = companySpecSubmittalFilename(submittalNumber, specSection ?? "");
  const prefix = companyJobFilenamePrefix(jobNumber, jobName);
  return `${IRONWOOD_SHORT_COMPANY_NAME} - ${prefix ? `${prefix} - ${base}` : base}`;
}

/** Company format: `ICBI - 1151 - Crusoe 2nd Floor - 002 - 09 72 00 - Wall Coverings.pdf` */
export function wallcoveringSubmittalFilename(
  jobName: string,
  jobNumber: string,
  submittalNumber: number,
  _submittalType: TradeSubmittalType,
  specSection?: string,
): string {
  const base = companySpecSubmittalFilename(submittalNumber, specSection ?? "");
  const prefix = companyJobFilenamePrefix(jobNumber, jobName);
  return `${IRONWOOD_SHORT_COMPANY_NAME} - ${prefix ? `${prefix} - ${base}` : base}`;
}

const RFI_SUBJECT_MAX = 50;

/** Hyphenated subject, at most 50 characters, cut on the last whole word. */
function rfiSubjectSlug(subject: string): string {
  const words = subject
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/[\\/:*?"<>|]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter(Boolean);

  let description = "";
  for (const word of words) {
    const next = description ? `${description}-${word}` : word;
    if (next.length > RFI_SUBJECT_MAX) {
      if (!description) return word.slice(0, RFI_SUBJECT_MAX);
      break;
    }
    description = next;
  }
  return description;
}

/** `RFI-003_Exterior-Existing-Plaster-Condition-Finish-Surface.pdf` */
export function rfiFilename(rfiNumber: string, subject?: string): string {
  const digits = rfiNumber.replace(/\D/g, "");
  const parsed = digits ? Number.parseInt(digits, 10) : Number.NaN;
  const numberPart = Number.isFinite(parsed) ? String(parsed).padStart(3, "0") : "000";
  const description = rfiSubjectSlug(subject ?? "");
  return description ? `RFI-${numberPart}_${description}.pdf` : `RFI-${numberPart}.pdf`;
}

export function wallcoveringOrderFormFilename(
  jobName: string,
  jobNumber: string,
  poNumber?: string,
): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const po = sanitizeFilenamePart((poNumber ?? "").replace(/^PO[-#]?\s*/i, "").trim());
  return po
    ? `${projectPart}_Wallcovering_Order_${po}.pdf`
    : `${projectPart}_Wallcovering_Order_Form.pdf`;
}

/** Company format: `ICBI - 001 - 06 60 00 - Plastic Fabrications (FRP).pdf` */
export function frpSubmittalFilename(
  _jobName: string,
  _jobNumber: string,
  submittalNumber: number,
  specSection?: string,
): string {
  return `${IRONWOOD_SHORT_COMPANY_NAME} - ${companySpecSubmittalFilename(submittalNumber, specSection ?? "")}`;
}

export function frpOrderFormFilename(jobName: string, jobNumber: string, poNumber?: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const po = sanitizeFilenamePart((poNumber ?? "").replace(/^PO[-#]?\s*/i, "").trim());
  return po ? `${projectPart}_FRP_Order_${po}.pdf` : `${projectPart}_FRP_Order_Form.pdf`;
}

export function trackOrderFormFilename(jobName: string, jobNumber: string, poNumber?: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const po = sanitizeFilenamePart((poNumber ?? "").replace(/^PO[-#]?\s*/i, "").trim());
  return po
    ? `${projectPart}_FWP_Order_${po}.pdf`
    : `${projectPart}_Stretched_Fabric_Track.pdf`;
}

export function budgetPdfJobTitle(jobNumber: string, jobName: string): string {
  const num = jobNumber.trim();
  const name = jobName.trim();
  if (num && name) return `${num} - ${name}`;
  return name || num || "Project";
}

export function budgetPdfFilename(jobName: string, jobNumber: string): string {
  return `${projectFilenamePart(jobName, jobNumber)}_Budget.pdf`;
}

export function budgetHoursPdfFilename(jobName: string, jobNumber: string): string {
  return `${projectFilenamePart(jobName, jobNumber)}_Budget_Hours.pdf`;
}

export function procurementLogFilename(jobName: string, jobNumber: string, d = new Date()): string {
  const datePart = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
  const num = sanitizeFilenamePart(jobNumber.trim() || "Job");
  const name = sanitizeFilenamePart(jobName.trim() || jobNumber.trim() || "Project");
  return `${num} ${name} - Procurement Log ${datePart}.pdf`;
}

export { companySpecSubmittalFilename, sdsPacketFilename } from "./sdsPacketPresets.js";
