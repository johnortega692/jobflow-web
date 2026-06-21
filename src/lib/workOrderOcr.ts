import type { ScanBBox, WorkOrderScanBoxes } from "../types/workOrderScan";
import { parseEwoDigitsFromOcr, parseEwoDateFromOcr, parseJobNumberFromOcr } from "./workOrderOcrParse";

type OcrWorker = {
  recognize: (image: ImageData | HTMLCanvasElement | string) => Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<OcrWorker> | null = null;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      return worker as OcrWorker;
    })();
  }
  return workerPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for OCR."));
    img.src = dataUrl;
  });
}

/** Map model-space bbox to pixel crop on a rasterized page image. */
export function bboxToPixelRect(
  bbox: ScanBBox,
  imageWidth: number,
  imageHeight: number,
  templateSize: { width: number; height: number } | null,
): { x: number; y: number; w: number; h: number } {
  const x1 = Math.min(bbox.x1, bbox.x2);
  const y1 = Math.min(bbox.y1, bbox.y2);
  const x2 = Math.max(bbox.x1, bbox.x2);
  const y2 = Math.max(bbox.y1, bbox.y2);

  if (templateSize && templateSize.width > 0 && templateSize.height > 0) {
    const sx = imageWidth / templateSize.width;
    const sy = imageHeight / templateSize.height;
    return {
      x: Math.round(x1 * sx),
      y: Math.round(y1 * sy),
      w: Math.max(1, Math.round((x2 - x1) * sx)),
      h: Math.max(1, Math.round((y2 - y1) * sy)),
    };
  }

  return {
    x: Math.round(x1),
    y: Math.round(y1),
    w: Math.max(1, Math.round(x2 - x1)),
    h: Math.max(1, Math.round(y2 - y1)),
  };
}

export function expandBBox(bbox: ScanBBox, fraction: number): ScanBBox {
  const x1 = Math.min(bbox.x1, bbox.x2);
  const y1 = Math.min(bbox.y1, bbox.y2);
  const x2 = Math.max(bbox.x1, bbox.x2);
  const y2 = Math.max(bbox.y1, bbox.y2);
  const w = x2 - x1;
  const h = y2 - y1;
  const padX = w * fraction;
  const padY = h * fraction;
  return {
    x1: x1 - padX,
    y1: y1 - padY,
    x2: x2 + padX,
    y2: y2 + padY,
  };
}

async function cropRegionToCanvas(
  backgroundDataUrl: string,
  bbox: ScanBBox,
  scanBoxes: WorkOrderScanBoxes,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(backgroundDataUrl);
  const template =
    scanBoxes.template_width > 0 && scanBoxes.template_height > 0
      ? { width: scanBoxes.template_width, height: scanBoxes.template_height }
      : null;
  const rect = bboxToPixelRect(bbox, img.naturalWidth, img.naturalHeight, template);

  const canvas = document.createElement("canvas");
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create OCR crop canvas.");
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return canvas;
}

export async function ocrRegionFromBackground(
  backgroundDataUrl: string,
  bbox: ScanBBox,
  scanBoxes: WorkOrderScanBoxes,
): Promise<string> {
  const canvas = await cropRegionToCanvas(backgroundDataUrl, bbox, scanBoxes);
  const worker = await getOcrWorker();
  const result = await worker.recognize(canvas);
  return result.data.text ?? "";
}

export async function ocrEwoFromBackground(
  backgroundDataUrl: string,
  scanBoxes: WorkOrderScanBoxes,
): Promise<string | null> {
  if (!scanBoxes.ewo) return null;
  let raw = await ocrRegionFromBackground(backgroundDataUrl, scanBoxes.ewo, scanBoxes);
  let digits = parseEwoDigitsFromOcr(raw);
  if (!digits) {
    const looser = expandBBox(scanBoxes.ewo, 0.18);
    raw = await ocrRegionFromBackground(backgroundDataUrl, looser, scanBoxes);
    digits = parseEwoDigitsFromOcr(raw);
  }
  return digits;
}

export async function ocrJobFromBackground(
  backgroundDataUrl: string,
  scanBoxes: WorkOrderScanBoxes,
): Promise<string | null> {
  if (!scanBoxes.job) return null;
  const raw = await ocrRegionFromBackground(backgroundDataUrl, scanBoxes.job, scanBoxes);
  return parseJobNumberFromOcr(raw);
}

export async function ocrDateFromBackground(
  backgroundDataUrl: string,
  scanBoxes: WorkOrderScanBoxes,
): Promise<string | null> {
  if (!scanBoxes.date) return null;
  let raw = await ocrRegionFromBackground(backgroundDataUrl, scanBoxes.date, scanBoxes);
  let parsed = parseEwoDateFromOcr(raw);
  if (!parsed) {
    raw = await ocrRegionFromBackground(backgroundDataUrl, expandBBox(scanBoxes.date, 0.15), scanBoxes);
    parsed = parseEwoDateFromOcr(raw);
  }
  return parsed;
}

export async function ocrFullPage(backgroundDataUrl: string): Promise<string> {
  const worker = await getOcrWorker();
  const result = await worker.recognize(backgroundDataUrl);
  return result.data.text ?? "";
}
