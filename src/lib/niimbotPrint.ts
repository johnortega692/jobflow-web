import "niimbot-web-bluetooth";
import { SAMPLE_LABEL_HEIGHT, SAMPLE_LABEL_WIDTH, type SampleLabelInput } from "./sampleLabelContent";
import { renderSampleLabelPng } from "./sampleLabelRender";

type NiimbotModel = {
  name_prefixes: string[];
  task: "b1";
  density: number;
  label_type: number;
  speed: number;
};

type NiimbotSize = {
  w_px: number;
  h_px: number;
  dpi: number;
  offset_y_px: number;
};

type NiimbotApi = {
  isSupported: () => boolean;
  connect: (model: NiimbotModel) => Promise<void>;
  DEBUG: boolean;
  /** 0 sends one protocol frame per Bluetooth write. */
  BUNDLE_MAX: number;
  /** How long to wait for the printer to report the page finished. */
  PAGE_WAIT_MS: number;
  /** How long to wait for the PageEnd acknowledgement, in milliseconds. */
  PAGE_ACK_MS: number;
  /** Upper bound for waiting on PageEnd and the feed, in milliseconds. */
  COMPLETION_MS: number;
  probe: (cmd: number, data?: number[], timeoutMs?: number) => Promise<{ cmd: number; data: number[] } | null>;
  printImage: (
    url: string,
    opts: { model: NiimbotModel; size: NiimbotSize; copies?: number; onProgress?: (status: string) => void },
  ) => Promise<void>;
  printBatch: (
    urls: string[],
    opts: { model: NiimbotModel; size: NiimbotSize; onProgress?: (status: string) => void },
  ) => Promise<void>;
};

const B1_MODEL: NiimbotModel = {
  name_prefixes: ["B1"],
  task: "b1",
  density: 3,
  label_type: 1,
  speed: 1,
};

/**
 * NiimBlue encodes a 50 mm label at 8 px/mm, which is 400 columns.
 * The B1 printhead is 384 dots. NiimBlue does not crop the canvas to the head;
 * it sends the 400-column page and the head prints the first 384 dots.
 */
const B1_PAGE_WIDTH = 50 * 8;

/** 50 × 80 mm at 203 dpi, already the print-page size after landscape rotation. */
const B1_50X80: NiimbotSize = {
  w_px: B1_PAGE_WIDTH,
  h_px: SAMPLE_LABEL_HEIGHT,
  dpi: 203,
  offset_y_px: 0,
};

function niimbotApi(): NiimbotApi {
  const api = (window as Window & { Niimbot?: NiimbotApi }).Niimbot;
  if (!api) throw new Error("NIIMBOT printer support did not load.");
  return api;
}

export function niimbotPrintSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator && Boolean(navigator.bluetooth);
}

function printFailure(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "NotAllowedError")) {
    return "No printer was selected.";
  }
  const message = error instanceof Error ? error.message : "Could not print on the NIIMBOT.";
  if (/cancel|chooser/i.test(message)) return "No printer was selected.";
  return message;
}

const KNOWN_LABEL_TYPES = new Set([1, 2, 3, 4, 5, 6, 10]);

function readU16(data: number[], offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

/** RFID paper reply: gap px, total height px, type, then millimetres × 10. */
function readPaperRoll(data: number[] | undefined): { labelType: number; heightPx: number; heightMm: number; widthMm: number } | null {
  if (!data || data.length < 18) return null;
  const heightPx = readU16(data, 2);
  const labelType = data[4] ?? 0;
  const heightMm = readU16(data, 7) / 10;
  const widthMm = readU16(data, 11) / 10;
  if (!KNOWN_LABEL_TYPES.has(labelType) || heightPx < 80 || heightPx > 2400) return null;
  return { labelType, heightPx, heightMm, widthMm };
}

/** Place the 384-wide design on the left of the 400-column page. Do not scale it. */
async function printPageUrl(url: string): Promise<{ url: string }> {
  const bitmap = await createImageBitmap(await fetch(url).then((response) => response.blob()));
  try {
    if (bitmap.width >= B1_PAGE_WIDTH) return { url };
    const canvas = document.createElement("canvas");
    canvas.width = B1_PAGE_WIDTH;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the print page.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Could not prepare the print page."))), "image/png");
    });
    return { url: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

/**
 * Send rendered 50×80 labels to a paired B1. Call this directly from the print click
 * so the browser still treats the Bluetooth chooser as a user gesture.
 */
export async function printNiimbotLabels(
  jobs: { input: SampleLabelInput; copies: number }[],
  onProgress?: (message: string) => void,
): Promise<void> {
  const api = niimbotApi();
  if (!api.isSupported()) {
    throw new Error("This browser can't reach a NIIMBOT printer. Use Chrome or Edge.");
  }
  const pending = jobs.filter((job) => job.copies > 0);
  if (!pending.length) throw new Error("Nothing to print.");

  onProgress?.("Connecting…");
    api.DEBUG = true;
  api.BUNDLE_MAX = 0;
  api.PAGE_WAIT_MS = 25000;
  api.PAGE_ACK_MS = 15000;
  api.COMPLETION_MS = 45000;
  const connected = api.connect(B1_MODEL);
  const urls: string[] = [];
  try {
    await connected;
    const paper = readPaperRoll((await api.probe(0x59, [0x01], 800))?.data);
    let model = B1_MODEL;
    let size = B1_50X80;
    if (paper) {
      console.log(
        `[niimbot] roll ${paper.widthMm}×${paper.heightMm} mm type=${paper.labelType} height=${paper.heightPx}px`,
      );
      if (Math.abs(paper.heightPx - SAMPLE_LABEL_HEIGHT) > 48) {
        throw new Error(
          `The roll in the printer is ${paper.widthMm} × ${paper.heightMm} mm. This label is 50 × 80 mm, so the printer will not feed it.`,
        );
      }
      model = { ...B1_MODEL, label_type: paper.labelType };
      size = { ...B1_50X80, h_px: paper.heightPx };
    } else {
      console.log("[niimbot] roll size not reported; using 50×80 mm gap labels");
    }
    onProgress?.("Drawing labels…");
    const pages: { url: string; copies: number }[] = [];
    for (const job of pending) {
      const blob = await renderSampleLabelPng(job.input);
      const rendered = URL.createObjectURL(blob);
      urls.push(rendered);
      const page = await printPageUrl(rendered);
      if (page.url !== rendered) urls.push(page.url);
      pages.push({ url: page.url, copies: Math.max(1, Math.min(99, job.copies)) });
    }
    console.log(
      `[niimbot] print page ${size.w_px}×${size.h_px} (design ${SAMPLE_LABEL_WIDTH}×${SAMPLE_LABEL_HEIGHT}, white columns past the 384-dot head)`,
    );
    const total = pages.reduce((sum, page) => sum + page.copies, 0);
    if (pages.length === 1) {
      onProgress?.(`Printing 1 of ${total}…`);
      await api.printImage(pages[0].url, {
        model,
        size,
        copies: pages[0].copies,
        onProgress: () => onProgress?.(`Printing 1 of ${total}…`),
      });
    } else {
      const queued = pages.flatMap((page) => Array.from({ length: page.copies }, () => page.url));
      onProgress?.(`Printing ${queued.length} labels…`);
      await api.printBatch(queued, {
        model,
        size,
        onProgress: (status) => onProgress?.(status),
      });
    }
    onProgress?.(`Printed ${total} label${total === 1 ? "" : "s"}.`);
  } catch (error) {
    throw new Error(printFailure(error));
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
