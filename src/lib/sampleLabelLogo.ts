import type { LetterheadSettings } from "../types/letterheadSettings";

export type SampleLabelLogoSource = {
  url: string;
  /** True when `url` is the main logo and must be converted before a thermal label prints it. */
  convertToBlackAndWhite: boolean;
};

/**
 * Uploaded label logo wins. Otherwise sample labels use the main logo, converted to pure black on white.
 */
export function resolveSampleLabelLogo(
  settings: Pick<LetterheadSettings, "label_logo_url" | "logo_url">,
): SampleLabelLogoSource {
  const label = settings.label_logo_url.trim();
  if (label) return { url: label, convertToBlackAndWhite: false };
  const main = settings.logo_url.trim();
  return { url: main, convertToBlackAndWhite: Boolean(main) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read logo"));
    image.src = url;
  });
}

/** Threshold the logo to pure black on white so a thermal printer does not dither grays. */
export async function logoToBlackAndWhitePng(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const res = await fetch(trimmed);
  if (!res.ok) throw new Error("Could not load logo");
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    const image = await loadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("Logo has no pixels");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not convert logo");
    ctx.drawImage(image, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      const luminance =
        alpha < 16 ? 255 : 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      const value = luminance < 200 ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Image a sample label should print: the black-and-white upload, or the main logo converted. */
export async function sampleLabelLogoImage(
  settings: Pick<LetterheadSettings, "label_logo_url" | "logo_url">,
): Promise<string> {
  const source = resolveSampleLabelLogo(settings);
  if (!source.url) return "";
  if (!source.convertToBlackAndWhite) return source.url;
  return logoToBlackAndWhitePng(source.url);
}
