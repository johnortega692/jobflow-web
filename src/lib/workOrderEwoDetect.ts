import { extractPdfPageText } from "./workOrderBackground";
import { ocrDateFromBackground, ocrEwoFromBackground, ocrFullPage } from "./workOrderOcr";
import { parseEwoDigitsFromOcr, parseFormDataFromFullPageOcr, parseEwoDateFromOcr } from "./workOrderOcrParse";
import {
  DEFAULT_EWO_DATE_SCAN_BOX,
  DEFAULT_EWO_SCAN_BOX,
  type WorkOrderScanBoxes,
} from "../types/workOrderScan";
import type { WorkOrderSourceMedia } from "../types/workOrder";

/** Sequential placeholder from "New EWO" (001, 002…) — not a document EWO number. */
export function isPlaceholderEwoNumber(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || /^\d{1,3}$/.test(trimmed);
}

export function parseEwoFromFilename(fileName: string): string | null {
  const match = fileName.match(/EWO\s*(\d+)/i);
  return match?.[1] ?? null;
}

export function scanBoxesWithDefaultEwo(
  boxes: WorkOrderScanBoxes,
  pageWidth: number,
  pageHeight: number,
): WorkOrderScanBoxes {
  return {
    ...boxes,
    ewo: boxes.ewo ?? { ...DEFAULT_EWO_SCAN_BOX },
    date: boxes.date ?? { ...DEFAULT_EWO_DATE_SCAN_BOX },
    template_width: pageWidth,
    template_height: pageHeight,
  };
}

export type DetectEwoInput = {
  backgroundDataUrl: string;
  sourceBytes: ArrayBuffer | null;
  sourceMediaType: WorkOrderSourceMedia | null;
  sourcePdfPage: number;
  pageWidth: number;
  pageHeight: number;
  scanBoxes: WorkOrderScanBoxes;
  fileName?: string;
};

/**
 * Detect EWO number from document — mirrors desktop load order:
 * filename → saved EWO scan region OCR → PDF text layer → full-page OCR.
 */
export async function detectEwoNumber(input: DetectEwoInput): Promise<string | null> {
  if (input.fileName) {
    const fromName = parseEwoFromFilename(input.fileName);
    if (fromName) return fromName;
  }

  const boxes = scanBoxesWithDefaultEwo(input.scanBoxes, input.pageWidth, input.pageHeight);

  const fromRegion = await ocrEwoFromBackground(input.backgroundDataUrl, boxes);
  if (fromRegion) return fromRegion;

  if (input.sourceBytes && input.sourceMediaType === "pdf") {
    try {
      const text = await extractPdfPageText(input.sourceBytes, input.sourcePdfPage);
      const { ewo } = parseFormDataFromFullPageOcr(text);
      if (ewo) return ewo;
      const loose = parseEwoDigitsFromOcr(text);
      if (loose) return loose;
    } catch {
      // Fall through to full-page OCR for scanned PDFs.
    }
  }

  const fullText = await ocrFullPage(input.backgroundDataUrl);
  const { ewo } = parseFormDataFromFullPageOcr(fullText);
  if (ewo) return ewo;
  return parseEwoDigitsFromOcr(fullText);
}

/**
 * Detect EWO date from document — PDF text → header date scan region → full-page OCR.
 */
export async function detectEwoDate(input: DetectEwoInput): Promise<string | null> {
  if (input.sourceBytes && input.sourceMediaType === "pdf") {
    try {
      const text = await extractPdfPageText(input.sourceBytes, input.sourcePdfPage);
      const { date } = parseFormDataFromFullPageOcr(text);
      if (date) return date;
      const loose = parseEwoDateFromOcr(text);
      if (loose) return loose;
    } catch {
      // Fall through to OCR for scanned PDFs.
    }
  }

  const boxes = scanBoxesWithDefaultEwo(input.scanBoxes, input.pageWidth, input.pageHeight);
  const fromRegion = await ocrDateFromBackground(input.backgroundDataUrl, boxes);
  if (fromRegion) return fromRegion;

  const fullText = await ocrFullPage(input.backgroundDataUrl);
  const { date } = parseFormDataFromFullPageOcr(fullText);
  if (date) return date;
  return parseEwoDateFromOcr(fullText);
}
