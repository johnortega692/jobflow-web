import { defaultLetterheadPdfVisibility } from "../types/letterheadSettings";
import { normalizeRevisionNumber } from "../types/tradeDocuments";
import { formatSubmittalDisplayDate } from "./dateInputUtils";
import { embedLogoUrlInHtml } from "./emailImageEmbed";
import { formatSpecSectionBannerText } from "./specSections";

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

/** Street + city/zip on one Address line for submittal PDF headers. */
export function projectAddressPrintHtml(street: string, cityLine: string): string {
  const combined = [street.trim(), cityLine.trim()].filter(Boolean).join(", ");
  return `<p class="info-row">Address: ${esc(combined)}</p>`;
}

export function formatSubmittalNumberDisplay(n: number | string | undefined): string {
  if (n === undefined || n === null || String(n).trim() === "") return "";
  if (typeof n === "number" && Number.isFinite(n)) return String(Math.trunc(n)).padStart(3, "0");
  const digits = String(n).trim().replace(/\D/g, "");
  if (digits) return String(parseInt(digits, 10)).padStart(3, "0");
  return String(n).trim().padStart(3, "0");
}

/** True when revision number is &gt; 0 (resubmittal of an existing package). */
export function isSubmittalRevision(revisionNumber: number | string | undefined): boolean {
  return normalizeRevisionNumber(revisionNumber) > 0;
}

/** Show revision note for Rev &gt; 0 packages, or when Type is Revised. */
export function shouldShowRevisionNote(
  revisionNumber: number | string | undefined,
  submittalType?: string | null,
): boolean {
  return isSubmittalRevision(revisionNumber) || submittalType === "revised";
}

export function formatRevisionNumberDisplay(n: number | string | undefined): string {
  return String(normalizeRevisionNumber(n));
}

export function submittalRevisionNoteHtml(
  revisionNumber: number | string | undefined,
  revisionNote?: string,
  submittalType?: string | null,
): string {
  const note = revisionNote?.trim();
  if (!note || !shouldShowRevisionNote(revisionNumber, submittalType)) return "";
  return `<p class="info-row revision-note"><strong>Revision Note:</strong> ${esc(note)}</p>`;
}

/** Grey bar: bold subject · Spec Section 09 91 23 – Name */
export function submittalSubjectSpecBannerHtml(subject: string, specSection: string): string {
  const subjectText = subject.trim();
  const specText = formatSpecSectionBannerText(specSection);
  if (!subjectText && !specText) return "";
  const subjectHtml = subjectText
    ? `<span class="subject-spec-bar-subject">${esc(subjectText)}</span>`
    : "";
  const sepHtml = subjectText && specText ? `<span class="subject-spec-bar-sep"> · </span>` : "";
  const specHtml = specText ? `<span class="subject-spec-bar-spec">${esc(specText)}</span>` : "";
  return `<div class="subject-spec-bar">${subjectHtml}${sepHtml}${specHtml}</div>`;
}

export function submittalDateSectionHtml(
  date: string,
  submittalNumber?: number | string,
  revisionNumber?: number | string,
): string {
  const parts: string[] = [];
  if (date.trim()) parts.push(`Date: ${esc(formatSubmittalDisplayDate(date.trim()))}`);
  if (submittalNumber !== undefined && submittalNumber !== null && String(submittalNumber).trim() !== "") {
    parts.push(`Submittal No: ${esc(formatSubmittalNumberDisplay(submittalNumber))}`);
  }
  if (isSubmittalRevision(revisionNumber)) {
    parts.push(`Revision: ${esc(formatRevisionNumberDisplay(revisionNumber))}`);
  }
  return parts.join("<br>");
}

export function submittalProjectInfoLines(project: {
  job_name: string;
  job_number: string;
  job_address: string;
  job_address_line2: string;
}): string[] {
  const lines = [`Project: ${project.job_name.trim()}`];
  if (project.job_number.trim()) lines.push(`Project Number: ${project.job_number.trim()}`);
  const address = [project.job_address.trim(), project.job_address_line2.trim()].filter(Boolean).join(", ");
  if (address) lines.push(`Address: ${address}`);
  return lines;
}

export function submittalProjectInfoHtml(project: {
  job_name: string;
  job_number: string;
  job_address: string;
  job_address_line2: string;
}): string {
  return submittalProjectInfoLines(project)
    .map((line) => `<p class="info-row">${esc(line)}</p>`)
    .join("");
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "msn.com",
]);

/** Company website label for PDF/email footers (e.g. ironwoodcb.com from signer email). */
export function companyWebsiteFromEmail(email: string): string {
  const match = email.trim().match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (!match) return "";
  const domain = match[1].toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return "";
  return domain;
}

export function submittalFooterSignerLines(branding: PrintBranding): string[] {
  const lines: string[] = [];
  if (branding.pdfShow.signer_name && branding.footerName.trim()) lines.push(branding.footerName.trim());
  if (branding.pdfShow.signer_phone && branding.footerPhone.trim()) lines.push(branding.footerPhone.trim());
  if (branding.pdfShow.signer_email && branding.footerEmail.trim()) lines.push(branding.footerEmail.trim());
  return lines;
}

export function submittalFooterCompanyLines(branding: PrintBranding): string[] {
  const lines: string[] = [];
  if (branding.pdfShow.company_name && branding.companyName.trim()) lines.push(branding.companyName.trim());
  const website = companyWebsiteFromEmail(branding.footerEmail);
  if (website) lines.push(website);
  return lines;
}

export function submittalFooterHtml(branding: PrintBranding): string {
  const signer = submittalFooterSignerLines(branding);
  const company = submittalFooterCompanyLines(branding);
  if (!signer.length && !company.length) return "";

  const name = signer[0] ?? "";
  const contact = signer.slice(1);

  return `<div class="footer-rule"></div>
  <div class="footer-signature-row">
    <div class="footer-signer">
      ${name ? `<p class="footer-signer-name">${esc(name)}</p>` : ""}
      ${contact.map((line) => `<p>${esc(line)}</p>`).join("")}
    </div>
    ${
      company.length
        ? `<div class="footer-company">${company.map((line) => `<p>${esc(line)}</p>`).join("")}</div>`
        : ""
    }
  </div>`;
}

export const SUBMITTAL_SIGNATURE_FOOTER_CSS = `
.footer-section {
  flex: 0 0 auto;
  font-size: 10.5pt;
  page-break-inside: avoid;
  break-inside: avoid;
}
.footer-rule { border-top: 1px solid #000; margin-bottom: 10px; }
.footer-signature-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.footer-signer { flex: 1 1 auto; }
.footer-signer p { margin: 0 0 3px; line-height: 1.3; }
.footer-signer-name { font-weight: bold; }
.footer-company { flex: 0 0 auto; text-align: right; font-size: 9pt; color: #595959; }
.footer-company p { margin: 0 0 3px; line-height: 1.3; }
`;

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
