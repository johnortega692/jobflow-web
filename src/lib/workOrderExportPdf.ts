import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  defaultTextSpacing,
  layoutOverlaySegments,
  overlaySegments,
  spacingForOverlay,
  type WorkOrderTextSpacing,
} from "./workOrderOverlayLayout";
import { TOTAL_LABEL_AMOUNT_GAP, isTotalRowVisible } from "./workOrderTotalPositions";
import type { WorkOrderOverlay, WorkOrderSourceMedia, WorkOrderDisplayPrefs } from "../types/workOrder";
import { DEFAULT_DISPLAY_PREFS } from "../types/workOrderScan";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return rgb(0.86, 0.15, 0.15);
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

/** PDF y is bottom-origin; overlays use top-origin. */
function pdfY(pageHeight: number, topY: number, fontSize: number): number {
  return pageHeight - topY - fontSize;
}

async function loadBackgroundPng(
  doc: PDFDocument,
  dataUrl: string,
): Promise<{ img: Awaited<ReturnType<PDFDocument["embedPng"]>>; width: number; height: number }> {
  const resp = await fetch(dataUrl);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const img = await doc.embedPng(bytes);
  return { img, width: img.width, height: img.height };
}

export async function exportWorkOrderPdf(options: {
  sourceBytes: ArrayBuffer | null;
  sourceMediaType: WorkOrderSourceMedia | null;
  pageWidth: number;
  pageHeight: number;
  sourcePdfPage?: number;
  overlays: WorkOrderOverlay[];
  display?: WorkOrderDisplayPrefs;
  textSpacing?: WorkOrderTextSpacing;
  /** Canvas raster — when set, export matches on-screen layout (WYSIWYG). */
  backgroundDataUrl?: string | null;
  filename: string;
}): Promise<void> {
  const {
    sourceBytes,
    sourceMediaType,
    pageWidth,
    pageHeight,
    overlays,
    filename,
    sourcePdfPage = 0,
    display = DEFAULT_DISPLAY_PREFS,
    backgroundDataUrl,
    textSpacing = defaultTextSpacing(),
  } = options;

  let doc: PDFDocument;
  let page: ReturnType<PDFDocument["addPage"]>;
  let width = pageWidth;
  let height = pageHeight;

  // Prefer the same raster the canvas displays so spacing/positions match the editor.
  if (backgroundDataUrl) {
    doc = await PDFDocument.create();
    const bg = await loadBackgroundPng(doc, backgroundDataUrl);
    width = bg.width;
    height = bg.height;
    page = doc.addPage([width, height]);
    page.drawImage(bg.img, { x: 0, y: 0, width, height });
  } else if (sourceBytes && sourceMediaType === "pdf") {
    const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    doc = await PDFDocument.create();
    const pageIdx = Math.min(Math.max(0, sourcePdfPage), src.getPageCount() - 1);
    const [embedded] = await doc.copyPages(src, [pageIdx]);
    doc.addPage(embedded);
    page = doc.getPage(0);
    width = page.getWidth();
    height = page.getHeight();
  } else {
    doc = await PDFDocument.create();
    page = doc.addPage([pageWidth, pageHeight]);
    width = pageWidth;
    height = pageHeight;

    if (sourceBytes && sourceMediaType === "image") {
      const bytes = new Uint8Array(sourceBytes);
      let img;
      try {
        img = await doc.embedPng(bytes);
      } catch {
        img = await doc.embedJpg(bytes);
      }
      const scale = Math.min(width / img.width, height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: 0, y: height - h, width: w, height: h });
    }
  }

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const scaleX = width / pageWidth;
  const scaleY = height / pageHeight;
  // Use one horizontal scale for font size and segment gaps — matches canvas model coords.
  const hScale = scaleX;
  const totalGap = TOTAL_LABEL_AMOUNT_GAP * hScale;

  for (const o of overlays) {
    const size = o.font_size * hScale;
    const x = o.x * scaleX;
    const y = pdfY(height, o.y * scaleY, size);
    const color = hexToRgb(o.color);

    if (o.section === "total") {
      if (!isTotalRowVisible(o.label, display)) continue;
      // Amounts always export (desktop behavior); labels are optional.
      if (o.amount.trim()) {
        page.drawText(o.amount, {
          x: x + totalGap,
          y,
          size,
          font,
          color,
        });
      }
      if (display.export_totals && display.show_total_labels && o.label.trim()) {
        page.drawText(o.label, { x, y, size, font, color });
      }
      continue;
    }

    const segments = overlaySegments(o, display);
    if (!segments.length) continue;
    const gapModel = spacingForOverlay(o, textSpacing);
    const layout = layoutOverlaySegments(segments, gapModel, o.font_size, (text, fontSize) =>
      font.widthOfTextAtSize(text, fontSize * hScale) / hScale,
    );
    for (let i = 0; i < layout.segments.length; i++) {
      page.drawText(layout.segments[i].text, {
        x: x + layout.offsets[i] * hScale,
        y,
        size,
        font,
        color,
      });
    }
  }

  const pdfBytes = await doc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
