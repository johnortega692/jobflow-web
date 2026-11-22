const MAX_EDGE = 480;
const MAX_DATA_URL = 180_000;

export async function fileToCatalogImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const url = canvas.toDataURL("image/jpeg", 0.72);
    if (!url.startsWith("data:image/jpeg") || url.length > MAX_DATA_URL) {
      throw new Error("Image is too large. Try a smaller photo.");
    }
    return url;
  } finally {
    bitmap.close();
  }
}
