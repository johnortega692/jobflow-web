import {
  PAINT_VENDOR_CODES,
  PAINT_VENDOR_OPTIONS,
  type PaintVendorLabel,
} from "./googleSheetsConfig.js";

export function paintTrackerBaseUrl(googleUrls: Record<string, string>): string {
  return (googleUrls.paint_tracker ?? "").trim();
}

export function normalizePaintVendor(raw: string): PaintVendorLabel {
  const trimmed = raw.trim();
  if (PAINT_VENDOR_OPTIONS.includes(trimmed as PaintVendorLabel)) {
    return trimmed as PaintVendorLabel;
  }
  for (const label of PAINT_VENDOR_OPTIONS) {
    if (PAINT_VENDOR_CODES[label] === trimmed) return label;
  }
  return "PPG";
}

const ORDER_VENDOR_LABELS: Record<string, PaintVendorLabel> = {
  ppg: "PPG",
  sw: "Sherwin Williams",
  sherwin: "Sherwin Williams",
  sherwinwilliams: "Sherwin Williams",
  bm: "Benjamin Moore",
  benjaminmoore: "Benjamin Moore",
  de: "Dunn Edwards",
  dunnedwards: "Dunn Edwards",
  vista: "Vista",
  vistapaint: "Vista",
};

function compactVendorKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Job paint vendor for a brush-out order recipient. Null when the brand is not one the job tracks. */
export function paintVendorLabelFromOrder(vendor: {
  brand?: string;
  name?: string;
  vendor_email?: string;
}): PaintVendorLabel | null {
  for (const raw of [vendor.brand, vendor.name]) {
    const label = ORDER_VENDOR_LABELS[compactVendorKey(raw ?? "")];
    if (label) return label;
  }
  const email = (vendor.vendor_email ?? "").toLowerCase();
  if (email.includes("sherwin")) return "Sherwin Williams";
  if (email.includes("dunnedwards") || email.includes("dunn-edwards")) return "Dunn Edwards";
  if (email.includes("vistapaint")) return "Vista";
  if (email.includes("pittsburgh") || email.includes("@ppg")) return "PPG";
  if (email.includes("benjaminmoore")) return "Benjamin Moore";
  return null;
}
