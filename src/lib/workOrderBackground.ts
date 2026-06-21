import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type RenderedPage = {
  dataUrl: string;
  width: number;
  height: number;
};

/** Rasterize a PDF page to PNG data URL (letter-sized display). */
export async function renderPdfPageToDataUrl(
  bytes: ArrayBuffer,
  pageIndex = 0,
  targetWidth = 612,
): Promise<RenderedPage> {
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  const pageNum = Math.min(Math.max(0, pageIndex), doc.numPages - 1);
  const page = await doc.getPage(pageNum + 1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available.");
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function getPdfPageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  return doc.numPages;
}

/** Extract embedded text from a PDF page (works when the PDF has a text layer). */
export async function extractPdfPageText(bytes: ArrayBuffer, pageIndex = 0): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  const pageNum = Math.min(Math.max(0, pageIndex), doc.numPages - 1);
  const page = await doc.getPage(pageNum + 1);
  const content = await page.getTextContent();
  return content.items
    .map((item) => ("str" in item ? String(item.str) : ""))
    .join(" ");
}

export async function readFileAsImageDataUrl(file: File, maxWidth = 612): Promise<RenderedPage> {
  const blob = file;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
  const img = await loadImage(dataUrl);
  const scale = maxWidth / img.naturalWidth;
  const w = Math.floor(img.naturalWidth * scale);
  const h = Math.floor(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available.");
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Invalid image."));
    img.src = src;
  });
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export async function renderWorkOrderBackground(
  file: File,
  pdfPageIndex = 0,
): Promise<RenderedPage & { mediaType: "pdf" | "image"; pageCount: number }> {
  if (isPdfFile(file)) {
    const buf = await file.arrayBuffer();
    const pageCount = await getPdfPageCount(buf);
    const page = await renderPdfPageToDataUrl(buf, pdfPageIndex);
    return { ...page, mediaType: "pdf", pageCount };
  }
  if (isImageFile(file)) {
    const page = await readFileAsImageDataUrl(file);
    return { ...page, mediaType: "image", pageCount: 1 };
  }
  throw new Error("Upload a PDF or image (PNG, JPG, WebP).");
}

export async function renderStoredPdfPage(
  bytes: ArrayBuffer,
  pageIndex: number,
  pageWidth: number,
): Promise<RenderedPage> {
  return renderPdfPageToDataUrl(bytes, pageIndex, pageWidth);
}

export async function renderStoredImage(bytes: ArrayBuffer, mime: string, maxWidth: number): Promise<RenderedPage> {
  const blob = new Blob([bytes], { type: mime });
  const file = new File([blob], "source", { type: mime });
  return readFileAsImageDataUrl(file, maxWidth);
}
