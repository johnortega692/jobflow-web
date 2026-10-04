import { leadSpecSection, normalizeRevisionNumber } from "../types/tradeDocuments";
import type { LetterheadSettings } from "../types/letterheadSettings";
import type { WallcoveringItem, WallcoveringSubmittalData } from "../types/tradeDocuments";
import { formatSubmittalNumberDisplay } from "./printCore";
import { resolveSampleLabelLogo } from "./sampleLabelLogo";

/** NIIMBOT B1, 50 × 80 mm at 203 dpi. */
export const SAMPLE_LABEL_WIDTH = 384;
export const SAMPLE_LABEL_HEIGHT = 640;
export const SAMPLE_LABEL_DPI = 203;
export const SAMPLE_LABEL_MARGIN = 12;
export const SAMPLE_LABEL_QR_PX = 116;
export const SAMPLE_LABEL_QR_QUIET = 2;
export const SAMPLE_LABEL_LOGO_MAX_H = 92;
export const SAMPLE_LABEL_BAND_H = 64;

/** Landscape design canvas. Export rotates it to the 384 × 640 print page. */
export const SAMPLE_LABEL_LANDSCAPE_WIDTH = 640;
export const SAMPLE_LABEL_LANDSCAPE_HEIGHT = 384;
export const SAMPLE_LABEL_LANDSCAPE_MARGIN_TOP = 12;
export const SAMPLE_LABEL_LANDSCAPE_MARGIN_X = 14;
export const SAMPLE_LABEL_LANDSCAPE_MARGIN_BOTTOM = 10;
export const SAMPLE_LABEL_LANDSCAPE_COL_W = 156;
/** Inner inset. 10px at 203 dpi; the sheet frame scales it to about 15px at 300 dpi. */
export const SAMPLE_LABEL_LANDSCAPE_COL_PAD = 10;
export const SAMPLE_LABEL_LANDSCAPE_QR = 128;
export const SAMPLE_LABEL_LANDSCAPE_RULE = 2;
export const SAMPLE_LABEL_LANDSCAPE_BAND_H = 56;
/** Column width minus the left and right inner padding. */
export const SAMPLE_LABEL_LANDSCAPE_LOGO_MAX_W =
  SAMPLE_LABEL_LANDSCAPE_COL_W - SAMPLE_LABEL_LANDSCAPE_COL_PAD * 2;

export type SampleLabelOrientation = "portrait" | "landscape";

export type SampleLabelQrKind = "share" | "product" | "website" | "none";

export type SampleLabelBlock =
  | "logo"
  | "qr"
  | "band"
  | "manufacturer"
  | "product"
  | "color"
  | "project"
  | "submittal"
  | "date"
  | "spec"
  | "footer";

export type SampleLabelInput = {
  logoUrl: string;
  qrKind: SampleLabelQrKind;
  qrUrl: string;
  companyName: string;
  itemLabel: string;
  manufacturer: string;
  product: string;
  color: string;
  project: string;
  /** Display value, e.g. "#001 · Rev 1". */
  submittal: string;
  date: string;
  spec: string;
  address: string;
  /** "Office ### · License # ###", already filtered by In PDF toggles. */
  officeLine: string;
  blocks?: Partial<Record<SampleLabelBlock, boolean>>;
  /** Defaults to portrait. */
  orientation?: SampleLabelOrientation;
  /** Black-band wording. Omitted keeps "WALLCOVERING SAMPLE". Blank prints the item code only. */
  bandText?: string;
};

export function sampleLabelBlockOn(input: SampleLabelInput, block: SampleLabelBlock): boolean {
  return input.blocks?.[block] !== false;
}

export function sampleLabelQrCaption(kind: Exclude<SampleLabelQrKind, "none">, companyName: string): string {
  if (kind === "share") return "SCAN FOR SPECS & SUBMITTAL FILES";
  if (kind === "product") return "SCAN FOR PRODUCT DATA";
  const name = companyName.trim().toUpperCase();
  return name ? `${name} WEBSITE` : "WEBSITE";
}

/** Product page, then the project share link, then a company website, otherwise no QR. */
export function resolveSampleLabelQrTarget(input: {
  productPageUrl?: string;
  sampleShareUrl?: string;
  companyWebsiteUrl?: string;
}): { kind: SampleLabelQrKind; url: string } {
  const product = input.productPageUrl?.trim() ?? "";
  if (product) return { kind: "product", url: product };
  const share = input.sampleShareUrl?.trim() ?? "";
  if (share) return { kind: "share", url: share };
  const site = input.companyWebsiteUrl?.trim() ?? "";
  if (site) return { kind: "website", url: site };
  return { kind: "none", url: "" };
}

export function formatSampleLabelSubmittal(submittalNumber: number, revisionNumber: number): string {
  const num = formatSubmittalNumberDisplay(submittalNumber);
  const rev = normalizeRevisionNumber(revisionNumber);
  if (!num) return `Rev ${rev}`;
  return `#${num} · Rev ${rev}`;
}

/** "Office ### · License # ###". Empty parts are omitted. */
export function formatSampleLabelOfficeLine(phone: string, license: string): string {
  const parts: string[] = [];
  const ph = phone.trim();
  const lic = license.trim();
  if (ph) {
    const stripped = ph.replace(/^office\s*:?\s*/i, "").trim();
    parts.push(`Office ${stripped || ph}`);
  }
  if (lic) {
    const stripped = lic.replace(/^license\s*#?\s*/i, "").replace(/^#\s*/, "").trim();
    parts.push(`License # ${stripped || lic}`);
  }
  return parts.join(" · ");
}

/** "09 72 00 - Wall Coverings" → the number, then the name. */
export function sampleLabelSpecLines(section: string): string[] {
  const text = section.trim();
  if (!text) return [];
  const match = text.match(/^(\d{2}\s*\d{2}\s*\d{2})\b\s*(?:[-–—]\s*)?([\s\S]*)$/);
  if (!match) return [text];
  const number = match[1]!.replace(/\s+/g, " ").trim();
  const name = (match[2] ?? "").trim();
  return name ? [number, name] : [number];
}

export function qrModuleGeometry(moduleCount: number, boxPx: number, quietModules = SAMPLE_LABEL_QR_QUIET) {
  const span = moduleCount + quietModules * 2;
  const modulePx = Math.max(1, Math.floor(boxPx / span));
  const drawn = span * modulePx;
  const offset = Math.floor((boxPx - drawn) / 2);
  return { span, modulePx, drawn, offset, quietModules };
}

export function wrapTextLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (value: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxLines < 1 || maxWidth <= 0) return [];
  const lines: string[] = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index] ?? "";
    index += 1;
    while (index < words.length) {
      const next = `${line} ${words[index]}`;
      if (measure(next) > maxWidth) break;
      line = next;
      index += 1;
    }
    const more = index < words.length;
    if (lines.length === maxLines - 1 && more) {
      line = `${line} ${words.slice(index).join(" ")}`.trim();
      index = words.length;
    }
    lines.push(measure(line) > maxWidth ? ellipsize(line, maxWidth, measure) : line);
  }
  return lines;
}

function ellipsize(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const ellipsis = "…";
  if (measure(ellipsis) > maxWidth) return ellipsis;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = `${text.slice(0, mid).trimEnd()}${ellipsis}`;
    if (measure(slice) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const cut = text.slice(0, lo).trimEnd();
  return cut ? `${cut}${ellipsis}` : ellipsis;
}

export type SampleLabelPrintShow = {
  logo: boolean;
  project: boolean;
  submittal: boolean;
  spec: boolean;
  date: boolean;
  addressPhone: boolean;
  license: boolean;
};

/** Product page is per item. Share folder and company website are one link on every label. */
export function sampleLabelQrForItem(args: {
  mode: SampleLabelQrKind;
  productPageUrl?: string;
  shareUrl?: string;
  websiteUrl?: string;
}): { kind: SampleLabelQrKind; url: string } {
  if (args.mode === "none") return { kind: "none", url: "" };
  if (args.mode === "product") {
    const url = args.productPageUrl?.trim() ?? "";
    return url ? { kind: "product", url } : { kind: "none", url: "" };
  }
  if (args.mode === "website") {
    const url = args.websiteUrl?.trim() ?? "";
    return url ? { kind: "website", url } : { kind: "none", url: "" };
  }
  const url = args.shareUrl?.trim() ?? "";
  return url ? { kind: "share", url } : { kind: "none", url: "" };
}

/** Dialog print path: the chosen QR mode and show toggles, not the automatic priority. */
export function sampleLabelInputForPrint(args: {
  letterhead: LetterheadSettings;
  projectName: string;
  item: Pick<WallcoveringItem, "label" | "manufacturer" | "product" | "color">;
  submittal: Pick<WallcoveringSubmittalData, "submittal_number" | "revision_number" | "date">;
  spec: string;
  qrKind: SampleLabelQrKind;
  qrUrl: string;
  show: SampleLabelPrintShow;
  orientation?: SampleLabelOrientation;
  bandText?: string;
  /** Sheet labels use the full-color company logo. Thermal labels keep the black-and-white mark. */
  colorLogo?: boolean;
}): SampleLabelInput {
  const url = args.qrUrl.trim();
  const kind: SampleLabelQrKind = args.qrKind === "none" || !url ? "none" : args.qrKind;
  const phone = args.show.addressPhone ? args.letterhead.company_phone : "";
  const license = args.show.license ? args.letterhead.company_license : "";
  return {
    logoUrl: args.colorLogo ? args.letterhead.logo_url.trim() : resolveSampleLabelLogo(args.letterhead).url,
    qrKind: kind,
    qrUrl: kind === "none" ? "" : url,
    companyName: args.letterhead.company_name,
    itemLabel: args.item.label.trim(),
    manufacturer: args.item.manufacturer.trim(),
    product: args.item.product.trim(),
    color: args.item.color.trim(),
    project: args.projectName.trim(),
    submittal: formatSampleLabelSubmittal(args.submittal.submittal_number, args.submittal.revision_number),
    date: args.submittal.date.trim(),
    spec: args.spec.trim(),
    address: args.show.addressPhone ? args.letterhead.company_address.trim() : "",
    officeLine: formatSampleLabelOfficeLine(phone, license),
    orientation: args.orientation ?? "portrait",
    bandText: args.bandText,
    blocks: {
      logo: args.show.logo,
      qr: kind !== "none",
      project: args.show.project,
      submittal: args.show.submittal,
      spec: args.show.spec,
      date: args.show.date,
    },
  };
}

export function sampleLabelInputFromWallcovering(args: {
  letterhead: LetterheadSettings;
  projectName: string;
  sampleShareUrl?: string;
  companyWebsiteUrl?: string;
  item: Pick<WallcoveringItem, "label" | "manufacturer" | "product" | "color" | "product_page_url">;
  submittal: Pick<WallcoveringSubmittalData, "submittal_number" | "revision_number" | "date" | "spec_section" | "spec_sections">;
  blocks?: Partial<Record<SampleLabelBlock, boolean>>;
}): SampleLabelInput {
  const show = args.letterhead.pdf_show;
  const qr = resolveSampleLabelQrTarget({
    productPageUrl: args.item.product_page_url,
    sampleShareUrl: args.sampleShareUrl,
    companyWebsiteUrl: args.companyWebsiteUrl,
  });
  const phone = show.company_phone ? args.letterhead.company_phone : "";
  const license = show.company_license ? args.letterhead.company_license : "";
  return {
    logoUrl: resolveSampleLabelLogo(args.letterhead).url,
    qrKind: qr.kind,
    qrUrl: qr.url,
    companyName: args.letterhead.company_name,
    itemLabel: args.item.label.trim(),
    manufacturer: args.item.manufacturer.trim(),
    product: args.item.product.trim(),
    color: args.item.color.trim(),
    project: args.projectName.trim(),
    submittal: formatSampleLabelSubmittal(args.submittal.submittal_number, args.submittal.revision_number),
    date: args.submittal.date.trim(),
    spec: leadSpecSection(args.submittal).trim(),
    address: show.company_address ? args.letterhead.company_address.trim() : "",
    officeLine: formatSampleLabelOfficeLine(phone, license),
    blocks: args.blocks,
  };
}
