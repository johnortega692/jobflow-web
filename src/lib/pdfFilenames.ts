import { companySpecSubmittalFilename, sanitizeFilenamePart } from "./sdsPacketPresets";
import { normalizeTransmittalNumber } from "./transmittalNumber";
import type { TradeSubmittalType } from "../types/tradeDocuments";

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
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const numPart = sanitizeFilenamePart(normalizeTransmittalNumber(transmittalNumber));
  return `${projectPart}_Transmittal_${numPart}.pdf`;
}

/** Company format: `003 - 09 91 23 - Interior Painting.pdf` */
export function paintSubmittalFilename(
  _jobName: string,
  _jobNumber: string,
  submittalNumber: number,
  _submittalType: TradeSubmittalType,
  specSection?: string,
): string {
  return companySpecSubmittalFilename(submittalNumber, specSection ?? "");
}

/** Company format: `002 - 09 72 00 - Wall Coverings.pdf` */
export function wallcoveringSubmittalFilename(
  _jobName: string,
  _jobNumber: string,
  submittalNumber: number,
  _submittalType: TradeSubmittalType,
  specSection?: string,
): string {
  return companySpecSubmittalFilename(submittalNumber, specSection ?? "");
}

export function rfiFilename(jobName: string, jobNumber: string, rfiNumber: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const rfiPart = sanitizeFilenamePart(rfiNumber.trim() || "RFI");
  return `${projectPart}_RFI_${rfiPart}.pdf`;
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

/** Company format: `001 - 06 60 00 - Plastic Fabrications (FRP).pdf` */
export function frpSubmittalFilename(
  _jobName: string,
  _jobNumber: string,
  submittalNumber: number,
  specSection?: string,
): string {
  return companySpecSubmittalFilename(submittalNumber, specSection ?? "");
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

export { companySpecSubmittalFilename, sdsPacketFilename } from "./sdsPacketPresets";
