import { defaultLetterheadPdfVisibility } from "../types/letterheadSettings";
import { embedLogoUrlInHtml } from "./emailImageEmbed";

function resolveAbsoluteAssetUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `${window.location.protocol}${trimmed}`;
  if (trimmed.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

export function normalizeLogoUrl(url: string): string {
  if (typeof window === "undefined") return url.trim();
  return resolveAbsoluteAssetUrl(url);
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Street + city/zip line block for submittal PDF headers. */
export function projectAddressPrintHtml(street: string, cityLine: string): string {
  const line1 = street.trim();
  const line2 = cityLine.trim();
  if (!line1 && !line2) return `<p class="info-row">Address:</p>`;
  if (!line2) return `<p class="info-row">Address: ${esc(line1)}</p>`;
  return `<p class="info-row">Address: ${esc(line1)}</p><p class="info-row">${esc(line2)}</p>`;
}

/** Letterhead line under logo: address | Office: phone | License #… */
export function buildCompanyContactLine(
  address: string,
  phone: string,
  license: string,
): string {
  const parts: string[] = [];
  const addr = address.trim();
  const ph = phone.trim();
  const lic = license.trim();
  if (addr) parts.push(addr);
  if (ph) parts.push(/^office\s*:/i.test(ph) ? ph : `Office: ${ph}`);
  if (lic) {
    if (/^license\s*#/i.test(lic)) parts.push(lic);
    else if (/^license/i.test(lic)) parts.push(lic);
    else parts.push(`License #${lic.replace(/^#/, "")}`);
  }
  return parts.join(" | ");
}

/** Settings → letterhead line (single row: address | phone | license). */
export function companyLetterheadLine(branding: PrintBranding): string {
  return (branding.companyContactLine || branding.companyInfo).trim();
}

export function cb(checked: boolean): string {
  return `<span class="cb${checked ? " checked" : ""}"></span>`;
}

export function printHtml(html: string, documentTitle?: string, logoUrl?: string): void {
  void printHtmlAsync(html, documentTitle, logoUrl);
}

async function printHtmlAsync(html: string, documentTitle?: string, logoUrl?: string): Promise<void> {
  let docHtml = html;
  const resolvedLogo = logoUrl ? normalizeLogoUrl(logoUrl) : "";
  if (resolvedLogo) {
    docHtml = await embedLogoUrlInHtml(docHtml, resolvedLogo);
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px;top:0;";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    frame.remove();
    throw new Error("Could not open print view. Try Chrome or Edge.");
  }
  doc.open();
  doc.write(docHtml);
  doc.close();
  if (documentTitle?.trim()) {
    doc.title = documentTitle.trim();
  }

  const waitForImages = () =>
    new Promise<void>((resolve) => {
      const images = Array.from(doc.images ?? []);
      if (!images.length) {
        resolve();
        return;
      }
      let pending = images.length;
      const done = () => {
        pending -= 1;
        if (pending <= 0) resolve();
      };
      for (const img of images) {
        if (img.complete) done();
        else {
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }
      }
      window.setTimeout(resolve, 2500);
    });

  const runPrint = async () => {
    await waitForImages();
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 1500);
  };

  if (doc.readyState === "complete") window.setTimeout(() => void runPrint(), 150);
  else frame.onload = () => window.setTimeout(() => void runPrint(), 150);
}

function ordinalFloorLabel(n: number): string {
  const mod100 = n % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix} Floor`;
}

/** Floors 1–30 for paint / wallcovering item dropdowns and PDF grouping order. */
export const FLOOR_OPTIONS = Array.from({ length: 30 }, (_, i) => ordinalFloorLabel(i + 1));

export const FLOOR_ORDER = [...FLOOR_OPTIONS, "All Floors", ""] as const;

export function groupByFloor<T extends { floor?: string }>(
  items: T[],
  floorOrder: readonly string[] = FLOOR_ORDER,
): [string, T[]][] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const floor = (item.floor ?? "").trim();
    if (!buckets.has(floor)) buckets.set(floor, []);
    buckets.get(floor)!.push(item);
  }
  const ordered: [string, T[]][] = [];
  for (const floor of floorOrder) {
    const list = buckets.get(floor);
    if (list?.length) ordered.push([floor, list]);
    buckets.delete(floor);
  }
  for (const [floor, list] of buckets) {
    if (list.length) ordered.push([floor, list]);
  }
  return ordered;
}

export function formatLongDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatShortDate(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

export type PrintBranding = {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyLicense: string;
  companyInfo: string;
  companyContactLine: string;
  logoUrl: string;
  logoAlt: string;
  footerName: string;
  footerPhone: string;
  footerEmail: string;
  fromBlock: string;
  fromPhone: string;
  signerName: string;
  signerTitle: string;
  signerPhone: string;
  signerEmail: string;
  pdfShow: import("../types/letterheadSettings").LetterheadPdfVisibility;
};

/** Name + title line for PDF signature blocks, respecting visibility toggles. */
export function pdfSignerDisplayName(branding: PrintBranding): string {
  const name = branding.pdfShow.signer_name ? branding.signerName.trim() : "";
  const title = branding.pdfShow.signer_title ? branding.signerTitle.trim() : "";
  if (name && title) return `${name}, ${title}`;
  return name || title;
}

/** @deprecated Use resolvePrintBranding() from letterheadSettings.ts */
export function getPrintBranding(): PrintBranding {
  const name = import.meta.env.VITE_COMPANY_NAME?.trim() || "Plan B Apps";
  const addr = import.meta.env.VITE_COMPANY_ADDRESS?.trim() || "";
  const phone = import.meta.env.VITE_COMPANY_PHONE?.trim() || "";
  const license = import.meta.env.VITE_COMPANY_LICENSE?.trim() || "";
  const email = import.meta.env.VITE_SIGNER_EMAIL?.trim() || "";
  const signer = import.meta.env.VITE_SIGNER_NAME?.trim() || name;
  const logoUrl = import.meta.env.VITE_LOGO_URL?.trim() || "";
  const companyContactLine = buildCompanyContactLine(addr, phone, license);
  const fromBlock = [name, addr].filter(Boolean).join("\n");
  return {
    companyName: name,
    companyAddress: addr,
    companyPhone: phone,
    companyLicense: license,
    companyInfo: companyContactLine,
    companyContactLine,
    logoUrl,
    logoAlt: name,
    footerName: signer,
    footerPhone: phone,
    footerEmail: email,
    fromBlock,
    fromPhone: phone,
    signerName: signer,
    signerTitle: "",
    signerPhone: phone,
    signerEmail: email,
    pdfShow: defaultLetterheadPdfVisibility(),
  };
}

export function logoBlock(branding: PrintBranding, fallbackText?: string): string {
  if (branding.logoUrl) {
    return `<img src="${esc(branding.logoUrl)}" alt="${esc(branding.logoAlt)}">`;
  }
  const text = (fallbackText || branding.logoAlt).trim();
  if (!text) return "";
  const html = esc(text).replace(/\n/g, "<br>");
  return `<div class="logo-text">${html}</div>`;
}
