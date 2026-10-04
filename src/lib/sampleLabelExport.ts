import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { downloadPdfBytes } from "./pdfDownload";
import { sanitizeFilenamePart } from "./sdsPacketPresets";
import type { SampleLabelInput } from "./sampleLabelContent";
import { renderSampleLabelPng } from "./sampleLabelRender";

const MM_TO_PT = 72 / 25.4;

/** One 50 × 80 mm page. */
export const SAMPLE_LABEL_PDF_WIDTH_PT = (50 * MM_TO_PT);
export const SAMPLE_LABEL_PDF_HEIGHT_PT = (80 * MM_TO_PT);

export type SampleLabelFile = {
  input: SampleLabelInput;
  copies: number;
  stem: string;
};

function clampCopies(copies: number): number {
  if (!Number.isFinite(copies)) return 1;
  return Math.min(99, Math.max(1, Math.floor(copies)));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function pngBytes(input: SampleLabelInput): Promise<Uint8Array> {
  const blob = await renderSampleLabelPng(input);
  return new Uint8Array(await blob.arrayBuffer());
}

export function uniqueSampleLabelStem(label: string, index: number, used: Set<string>): string {
  const base = sanitizeFilenamePart(label) || `Item-${index + 1}`;
  let stem = base;
  let n = 2;
  while (used.has(stem.toLowerCase())) {
    stem = `${base}_${n}`;
    n += 1;
  }
  used.add(stem.toLowerCase());
  return stem;
}

/** One page per physical label, in list order, with copies repeated. */
export async function buildSampleLabelsPdf(files: SampleLabelFile[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const file of files) {
    const bytes = await pngBytes(file.input);
    const png = await doc.embedPng(bytes);
    const copies = clampCopies(file.copies);
    for (let i = 0; i < copies; i++) {
      const page = doc.addPage([SAMPLE_LABEL_PDF_WIDTH_PT, SAMPLE_LABEL_PDF_HEIGHT_PT]);
      page.drawImage(png, {
        x: 0,
        y: 0,
        width: SAMPLE_LABEL_PDF_WIDTH_PT,
        height: SAMPLE_LABEL_PDF_HEIGHT_PT,
      });
    }
  }
  return doc.save();
}

export async function downloadSampleLabelsPdf(files: SampleLabelFile[], filename: string): Promise<void> {
  downloadPdfBytes(await buildSampleLabelsPdf(files), filename);
}

/** One PNG per physical label, copies repeated, zipped in list order. */
export async function downloadSampleLabelsZip(files: SampleLabelFile[], filename: string): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    const bytes = await pngBytes(file.input);
    const copies = clampCopies(file.copies);
    for (let i = 0; i < copies; i++) {
      const name = copies === 1 ? `${file.stem}.png` : `${file.stem}-${i + 1}.png`;
      zip.file(name, bytes);
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`);
}
