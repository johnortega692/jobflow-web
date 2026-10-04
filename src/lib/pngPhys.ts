const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/** Pixels per meter for a pHYs chunk. 203 dpi → 7992 px/m. */
export function pngPixelsPerMeter(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

function physData(dpi: number): Uint8Array {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  const ppm = pngPixelsPerMeter(dpi);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1;
  return data;
}

function isPng(png: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => png[index] === byte);
}

/**
 * Insert or replace a pHYs chunk so readers treat the bitmap as `dpi` dots per inch.
 * The chunk sits immediately after IHDR.
 */
export function withPngPhys(png: Uint8Array, dpi: number): Uint8Array {
  const bytes = png.byteOffset === 0 && png.byteLength === png.buffer.byteLength ? png : new Uint8Array(png);
  if (!isPng(bytes) || bytes.length < 24) throw new Error("Not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (ihdrType !== "IHDR") throw new Error("PNG is missing IHDR");
  const afterIhdr = 8 + 12 + ihdrLength;
  let restStart = afterIhdr;
  if (afterIhdr + 8 <= bytes.length) {
    const nextType = String.fromCharCode(
      bytes[afterIhdr + 4] ?? 0,
      bytes[afterIhdr + 5] ?? 0,
      bytes[afterIhdr + 6] ?? 0,
      bytes[afterIhdr + 7] ?? 0,
    );
    if (nextType === "pHYs") {
      const physLength = view.getUint32(afterIhdr);
      restStart = afterIhdr + 12 + physLength;
    }
  }
  const phys = chunk("pHYs", physData(dpi));
  const out = new Uint8Array(afterIhdr + phys.length + (bytes.length - restStart));
  out.set(bytes.subarray(0, afterIhdr), 0);
  out.set(phys, afterIhdr);
  out.set(bytes.subarray(restStart), afterIhdr + phys.length);
  return out;
}
