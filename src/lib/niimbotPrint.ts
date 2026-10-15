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
  /** How long to wait for the printer to report the page finished. */
  PAGE_WAIT_MS: number;
  printImage: (
    url: string,
    opts: { model: NiimbotModel; size: NiimbotSize; copies?: number; onProgress?: (status: string) => void },
  ) => Promise<void>;
};

const B1_MODEL: NiimbotModel = {
  name_prefixes: ["B1"],
  task: "b1",
  density: 3,
  label_type: 1,
  speed: 1,
};

/** 50 × 80 mm at 203 dpi, already the print-page size after landscape rotation. */
const B1_50X80: NiimbotSize = {
  w_px: SAMPLE_LABEL_WIDTH,
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
  if (/print not confirmed/i.test(message)) {
    return "The printer didn't confirm the label finished. Check the paper before printing again.";
  }
  return message;
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
  api.PAGE_WAIT_MS = 60000;
  const connected = api.connect(B1_MODEL);
  const urls: string[] = [];
  try {
    await connected;
    onProgress?.("Drawing labels…");
    const pages: { url: string; copies: number }[] = [];
    for (const job of pending) {
      const blob = await renderSampleLabelPng(job.input);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      pages.push({ url, copies: Math.max(1, Math.min(99, job.copies)) });
    }
    const total = pages.reduce((sum, page) => sum + page.copies, 0);
    let done = 0;
    for (const page of pages) {
      onProgress?.(`Printing ${done + 1} of ${total}…`);
      await api.printImage(page.url, {
        model: B1_MODEL,
        size: B1_50X80,
        copies: page.copies,
        onProgress: () => onProgress?.(`Printing ${Math.min(total, done + 1)} of ${total}…`),
      });
      done += page.copies;
    }
    onProgress?.(`Printed ${total} label${total === 1 ? "" : "s"}.`);
  } catch (error) {
    throw new Error(printFailure(error));
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
