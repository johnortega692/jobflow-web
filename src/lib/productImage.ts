import { authFetch } from "./apiAuth";

export type LoadedProductImage = {
  bytes: Uint8Array;
  contentType: string;
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sniffedType(bytes: Uint8Array, header: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("image/") ? type : "";
}

/** PDF viewers cannot paint a progressive JPEG embedded as-is. */
export function isProgressiveJpeg(bytes: Uint8Array): boolean {
  let i = 2;
  while (i < bytes.length - 4) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xc2) return true;
    if (marker === 0xc0 || marker === 0xc1) return false;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2) break;
    i += 2 + length;
  }
  return false;
}

async function readDirect(url: string): Promise<LoadedProductImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = sniffedType(bytes, response.headers.get("content-type") ?? "");
    if (!contentType) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/** Load image bytes from a product URL. Falls back to the app server when the host blocks the browser. */
export async function loadProductImage(url: string): Promise<LoadedProductImage | null> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const direct = await readDirect(trimmed);
  if (direct) return direct;
  if (!trimmed.startsWith("https://")) return null;
  try {
    const response = await authFetch("/api/fetch-image", {
      method: "POST",
      body: JSON.stringify({ url: trimmed }),
    });
    const body = (await response.json()) as { contentType?: string; imageBase64?: string; error?: string };
    if (!response.ok || !body.imageBase64) return null;
    const bytes = decodeBase64(body.imageBase64);
    const contentType = sniffedType(bytes, body.contentType ?? "");
    if (!contentType) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/** Draw an image the PDF library cannot embed (WebP, GIF) into a PNG. */
export function pngBytesFromImage(bytes: Uint8Array, contentType: string): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(objectUrl);
        if (!png) {
          resolve(null);
          return;
        }
        void png.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null));
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}
