/** Paint schedule image import — client helpers. */

import { authFetch } from "./apiAuth";

export type ExtractedPaintRow = {
  label: string;
  manufacturer: string;
  color: string;
  product: string;
  sheen: string;
  floor: string;
};

const MANUFACTURERS = [
  "BENJAMIN MOORE & CO",
  "BENJAMIN MOORE",
  "SHERWIN-WILLIAMS",
  "SHERWIN WILLIAMS",
  "KELLY-MOORE",
  "KELLY MOORE",
  "DUNN-EDWARDS",
  "DUNN EDWARDS",
  "VISTA PAINTS",
  "SCUFFMASTER",
  "PPG",
  "BEHR",
] as const;

const MANUFACTURER_ABBREV: Record<string, string> = {
  "BENJAMIN MOORE & CO": "BM",
  "BENJAMIN MOORE": "BM",
  "SHERWIN-WILLIAMS": "SW",
  "SHERWIN WILLIAMS": "SW",
  "KELLY-MOORE": "KM",
  "KELLY MOORE": "KM",
  "DUNN-EDWARDS": "DE",
  "DUNN EDWARDS": "DE",
  PPG: "PPG",
  BEHR: "BEHR",
  "VISTA PAINTS": "Vista Paints",
  SCUFFMASTER: "SCUFFMASTER",
};

export function abbreviateManufacturer(name: string): string {
  const upper = name.toUpperCase().trim();
  for (const mfr of MANUFACTURERS) {
    if (upper.includes(mfr)) return MANUFACTURER_ABBREV[mfr] ?? mfr;
  }
  return name.trim();
}

export function paintColorForPrint(manufacturer: string, color: string): string {
  const m = manufacturer.trim();
  const c = color.trim();
  if (!m) return c;
  if (!c) return abbreviateManufacturer(m);
  if (c.toUpperCase().includes(m.toUpperCase())) return c;
  return `${abbreviateManufacturer(m)} ${c}`;
}

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const mediaType = file.type || "image/jpeg";
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return { data: btoa(binary), mediaType };
}

/** Image from Ctrl+V / paste event */
export function imageFileFromDataTransfer(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null;
  for (const item of dataTransfer.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** Image from clipboard API (Paste button) */
export async function imageFileFromClipboard(): Promise<File | null> {
  if (!navigator.clipboard?.read) {
    throw new Error("Clipboard read not supported in this browser. Click this box and press Ctrl+V instead.");
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        return new File([blob], `clipboard.${ext}`, { type: blob.type || type });
      }
    }
  }
  return null;
}

const MAX_IMAGE_BYTES = 3_500_000;

async function readApiJson(res: Response): Promise<{ items?: ExtractedPaintRow[]; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { items?: ExtractedPaintRow[]; error?: string };
  } catch {
    const snippet = text.trim().slice(0, 160);
    if (snippet.includes("FUNCTION_INVOCATION_FAILED") || snippet.startsWith("A server error")) {
      throw new Error(
        "AI import server is not running on Vercel yet. Add ANTHROPIC_API_KEY under Project → Settings → Environment Variables, then redeploy the latest build (not an old failed one).",
      );
    }
    throw new Error(snippet || `Import failed (${res.status})`);
  }
}

export async function extractPaintFromImage(file: File): Promise<ExtractedPaintRow[]> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      "Image is too large for upload. Crop the screenshot or save a smaller copy (under ~3 MB), then try again.",
    );
  }

  const { data, mediaType } = await fileToBase64(file);
  const res = await authFetch("/api/extract-paint", {
    method: "POST",
    body: JSON.stringify({ image_base64: data, media_type: mediaType }),
  });
  const body = await readApiJson(res);
  if (!res.ok) {
    throw new Error(body.error ?? `Import failed (${res.status})`);
  }
  if (!body.items?.length) throw new Error("No paint items found in the image.");
  return body.items;
}
