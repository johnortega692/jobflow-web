import { packetPackageNumber, sanitizeFilenamePart } from "./sdsPacketPresets";
import { normalizeTransmittalNumber } from "./transmittalNumber";
import type { TradeSubmittalType } from "../types/tradeDocuments";

export function projectFilenamePart(
  jobName: string,
  jobNumber: string,
  fallback = "Project",
): string {
  return sanitizeFilenamePart(jobName.trim() || jobNumber.trim() || fallback);
}

export function pdfTitleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

const TRADE_SUBMITTAL_SLUG: Record<TradeSubmittalType, string> = {
  new: "BrushOuts",
  revised: "Revised",
  substitution: "Substitution",
  original: "Original",
};

function tradeSubmittalSlug(type: TradeSubmittalType): string {
  return TRADE_SUBMITTAL_SLUG[type] ?? "Submittal";
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

export function paintSubmittalFilename(
  jobName: string,
  jobNumber: string,
  submittalNumber: number,
  submittalType: TradeSubmittalType,
): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const typePart = tradeSubmittalSlug(submittalType);
  const numPart = packetPackageNumber(submittalNumber);
  return `${projectPart}_Paint_Submittal_${typePart}_${numPart}.pdf`;
}

export function wallcoveringSubmittalFilename(
  jobName: string,
  jobNumber: string,
  submittalNumber: number,
  submittalType: TradeSubmittalType,
): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const typePart = tradeSubmittalSlug(submittalType);
  const numPart = packetPackageNumber(submittalNumber);
  return `${projectPart}_Wallcovering_Submittal_${typePart}_${numPart}.pdf`;
}

export function rfiFilename(jobName: string, jobNumber: string, rfiNumber: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const rfiPart = sanitizeFilenamePart(rfiNumber.trim() || "RFI");
  return `${projectPart}_RFI_${rfiPart}.pdf`;
}

export function wallcoveringOrderFormFilename(jobName: string, jobNumber: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  return `${projectPart}_Wallcovering_Order_Form.pdf`;
}

export function frpSubmittalFilename(jobName: string, jobNumber: string, submittalNumber: number): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  const numPart = packetPackageNumber(submittalNumber);
  return `${projectPart}_FRP_Submittal_${numPart}.pdf`;
}

export function frpOrderFormFilename(jobName: string, jobNumber: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  return `${projectPart}_FRP_Order_Form.pdf`;
}

export function trackOrderFormFilename(jobName: string, jobNumber: string): string {
  const projectPart = projectFilenamePart(jobName, jobNumber);
  return `${projectPart}_Stretched_Fabric_Track.pdf`;
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

export { sdsPacketFilename } from "./sdsPacketPresets";
