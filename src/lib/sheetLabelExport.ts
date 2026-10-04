import { PDFDocument, rgb } from "pdf-lib";
import { downloadPdfBytes } from "./pdfDownload";
import type { SampleLabelInput } from "./sampleLabelContent";
import { renderSheetLabel } from "./sampleLabelRender";
import { layoutSheetPages, type SheetLabelTemplate } from "./sheetLabelTemplate";

const IN_TO_PT = 72;

function inches(value: number): number {
  return value * IN_TO_PT;
}

async function sheetPng(input: SampleLabelInput): Promise<Uint8Array> {
  const canvas = await renderSheetLabel(input);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("Could not export sheet label"))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** One Letter page per sheet. Each label image is placed at its template box in inches. */
export async function buildSheetLabelsPdf(args: {
  inputs: SampleLabelInput[];
  template: SheetLabelTemplate;
  startAt: number;
  outlines: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pages = layoutSheetPages(args.template, args.inputs.length, args.startAt);
  const pngs = await Promise.all(args.inputs.map((input) => sheetPng(input)));
  const images = await Promise.all(pngs.map((bytes) => doc.embedPng(bytes)));
  const { template } = args;
  const labelW = inches(template.labelWidthIn);
  const labelH = inches(template.labelHeightIn);
  for (const slots of pages) {
    const page = doc.addPage([inches(template.pageWidthIn), inches(template.pageHeightIn)]);
    for (const slot of slots) {
      const x = inches(slot.xIn);
      const y = inches(template.pageHeightIn - slot.yIn - template.labelHeightIn);
      if (slot.kind === "label" && slot.labelIndex !== undefined) {
        const image = images[slot.labelIndex];
        if (image) page.drawImage(image, { x, y, width: labelW, height: labelH });
      }
      if (args.outlines) {
        page.drawRectangle({
          x,
          y,
          width: labelW,
          height: labelH,
          borderWidth: 0.5,
          borderColor: rgb(0, 0, 0),
        });
      }
    }
  }
  return doc.save();
}

export async function downloadSheetLabelsPdf(
  args: {
    inputs: SampleLabelInput[];
    template: SheetLabelTemplate;
    startAt: number;
    outlines: boolean;
  },
  filename: string,
): Promise<void> {
  downloadPdfBytes(await buildSheetLabelsPdf(args), filename);
}
