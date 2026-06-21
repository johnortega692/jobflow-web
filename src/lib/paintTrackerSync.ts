import {
  PAINT_VENDOR_CODES,
  PAINT_VENDOR_OPTIONS,
  type PaintVendorLabel,
} from "./googleSheetsConfig";

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
