import {
  DEFAULT_SCAN_ENHANCE,
  isDefaultScanEnhance,
  type ScanEnhanceSettings,
} from "../types/workOrderScan";

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for scan enhance."));
    img.src = dataUrl;
  });
}

/** Port of desktop apply_scan_enhance_to_pil — grayscale levels + contrast + sharpness. */
function applyEnhanceToImageData(data: ImageData, settings: ScanEnhanceSettings): void {
  const { ink, paper, contrast, sharpness } = settings;
  const bi = Math.max(0, Math.min(120, Math.round(ink * 1.15)));
  const wi = Math.max(bi + 8, Math.min(255, 255 - Math.round(paper * 0.52)));
  const span = Math.max(1, wi - bi);
  const cf = Math.max(0.25, Math.min(1.9, 0.5 + contrast / 100));
  const sf = Math.max(0.08, Math.min(2.0, sharpness / 50));

  const { width, height, data: px } = data;
  const gray = new Uint8ClampedArray(width * height);

  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    let v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (v <= bi) v = 0;
    else if (v >= wi) v = 255;
    else v = Math.round(((v - bi) * 255) / span);
    gray[p] = v;
  }

  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    let v = gray[p];
    v = Math.max(0, Math.min(255, Math.round((v - 128) * cf + 128)));
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }

  if (Math.abs(sf - 1) > 0.02) {
    const blurred = new Uint8ClampedArray(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const sum =
          gray[idx - width - 1] +
          gray[idx - width] +
          gray[idx - width + 1] +
          gray[idx - 1] +
          gray[idx] +
          gray[idx + 1] +
          gray[idx + width - 1] +
          gray[idx + width] +
          gray[idx + width + 1];
        blurred[idx] = Math.round(sum / 9);
      }
    }
    const amount = sf - 1;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const i = idx * 4;
        const orig = px[i];
        const blur = blurred[idx];
        const sharp = Math.max(0, Math.min(255, Math.round(orig + amount * (orig - blur))));
        px[i] = sharp;
        px[i + 1] = sharp;
        px[i + 2] = sharp;
      }
    }
  }
}

export async function applyScanEnhanceToDataUrl(
  dataUrl: string,
  settings: ScanEnhanceSettings = DEFAULT_SCAN_ENHANCE,
): Promise<string> {
  if (isDefaultScanEnhance(settings)) return dataUrl;

  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyEnhanceToImageData(imageData, settings);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
