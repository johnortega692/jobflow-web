import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { authFetch } from "./apiAuth";
import { gcScheduleFromAiRows, type GcScheduleAiRow, type GcScheduleParseResult } from "./gcScheduleImport";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const MAX_PAGES = 12;
const PAGES_PER_REQUEST = 3;

type PageImage = { image_base64: string; media_type: string };

async function renderSchedulePages(buffer: ArrayBuffer): Promise<{ pages: PageImage[]; pageCount: number }> {
  const doc = await getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const pageCount = doc.numPages;
  const limit = Math.min(pageCount, MAX_PAGES);
  const pages: PageImage[] = [];
  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.4, 1400 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not draw the schedule page.");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob) throw new Error("Could not prepare a schedule page for AI.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
    pages.push({ image_base64: btoa(binary), media_type: "image/jpeg" });
  }
  return { pages, pageCount };
}

async function readApiJson(res: Response): Promise<{ activities?: GcScheduleAiRow[]; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { activities?: GcScheduleAiRow[]; error?: string };
  } catch {
    const snippet = text.trim().slice(0, 180);
    if (snippet.includes("FUNCTION_INVOCATION_FAILED") || snippet.startsWith("A server error")) {
      throw new Error(
        "AI import is not available yet. Add ANTHROPIC_API_KEY in Vercel, then redeploy.",
      );
    }
    throw new Error(snippet || `AI import failed (${res.status})`);
  }
}

/** Read a scanned GC schedule by sending page images to AI. */
export async function extractGcScheduleWithAi(file: File): Promise<GcScheduleParseResult> {
  const { pages, pageCount } = await renderSchedulePages(await file.arrayBuffer());
  if (!pages.length) throw new Error("That PDF has no pages to read.");

  const found: GcScheduleAiRow[] = [];
  for (let index = 0; index < pages.length; index += PAGES_PER_REQUEST) {
    const batch = pages.slice(index, index + PAGES_PER_REQUEST);
    const res = await authFetch("/api/extract-gc-schedule", {
      method: "POST",
      body: JSON.stringify({ pages: batch }),
    });
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body.error ?? `AI import failed (${res.status})`);
    found.push(...(body.activities ?? []));
  }

  const limited = pageCount > pages.length ? ` · first ${pages.length} of ${pageCount} pages` : "";
  return gcScheduleFromAiRows(found, `${file.name} (AI)${limited}`, pageCount);
}
