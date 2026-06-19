import { buildEmailSignatureHtml } from "./emailSignature";
import type { EmailSignatureSettings } from "./emailSignature";
import { copyOutlookHtmlToClipboard, emailParagraph, outlookSpacer } from "./outlookClipboard";
import { FLOOR_ORDER } from "./printCore";
import type { PaintItem, TradeSubmittalType } from "../types/tradeDocuments";

export type PaintVendor = {
  name: string;
  brand: string;
  vendor_email: string;
  store_email?: string;
};

let vendorsCache: PaintVendor[] | null = null;

export async function loadDefaultPaintVendorsFromJson(): Promise<PaintVendor[]> {
  if (vendorsCache) return vendorsCache;
  const res = await fetch("/json/vendors.json");
  if (!res.ok) throw new Error("Could not load vendors.json");
  const data = (await res.json()) as { vendors?: PaintVendor[] };
  vendorsCache = data.vendors ?? [];
  return vendorsCache;
}

/** @deprecated Prefer vendors from loadPaintUserSettings */
export async function loadPaintVendors(): Promise<PaintVendor[]> {
  return loadDefaultPaintVendorsFromJson();
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripProductMfr(product: string): string {
  return product.replace(/\s*\([A-Z]+\)\s*$/i, "").trim();
}

function groupByFloor(items: PaintItem[]): [string, PaintItem[]][] {
  const floorsSeen: Record<string, PaintItem[]> = {};
  for (const item of items) {
    const floor = item.floor.trim();
    if (!floorsSeen[floor]) floorsSeen[floor] = [];
    floorsSeen[floor]!.push(item);
  }
  const result: [string, PaintItem[]][] = [];
  for (const f of FLOOR_ORDER) {
    if (floorsSeen[f]?.length) result.push([f, floorsSeen[f]!]);
  }
  for (const [f, list] of Object.entries(floorsSeen)) {
    if (!FLOOR_ORDER.includes(f as (typeof FLOOR_ORDER)[number]) && list.length) result.push([f, list]);
  }
  return result;
}

export function buildVendorEmailSubject(
  jobNumber: string,
  jobName: string,
  submittalType: TradeSubmittalType,
): string {
  const job = `${jobNumber} ${jobName}`.trim();
  if (submittalType === "new") return `Brush Out Request - New Colors | ${job}`;
  if (submittalType === "substitution") return `Brush Out Request - Color Substitution | ${job}`;
  if (submittalType === "revised") return `Brush Out Request - Revised Colors | ${job}`;
  return `Brush Out request for Job ${job}`;
}

function vendorFirstName(vendorName: string): string {
  return vendorName.split(/\s+/)[0] || "there";
}

function introPlain(
  vendorName: string,
  jobNumber: string,
  jobName: string,
  submittalType: TradeSubmittalType,
  defaultQty: number,
): string {
  const first = vendorFirstName(vendorName);
  const job = `${jobNumber} - ${jobName}`.trim();
  if (submittalType === "new") {
    return `Hi ${first},\n\nWe are adding new paint colors to Job ${job}. Please provide brush-outs for the new colors listed below.\n\nThe brush-outs can be delivered or shipped to our office at your convenience.\n\nNew Colors Added:\n`;
  }
  if (submittalType === "substitution") {
    return `Hi ${first},\n\nWe need to substitute paint colors on Job ${job}. Please provide brush-outs for the new colors only.\n\nColor Substitutions:\n`;
  }
  if (submittalType === "revised") {
    return `Hi ${first},\n\nWe need to revise the paint colors for Job ${job}. Control samples will be dropped off at your location for color matching.\n\nRevised Colors:\n`;
  }
  return `Hi ${first},\n\nCan you please provide ${defaultQty} brush-outs in the specified colors and sheens? You can have them delivered or shipped to our office.\n\nScope of Work:\n`;
}

function introHtml(
  vendorName: string,
  jobNumber: string,
  jobName: string,
  submittalType: TradeSubmittalType,
  defaultQty: number,
): string {
  const greeting = `Hi ${escHtml(vendorFirstName(vendorName))},`;
  const job = `${escHtml(jobNumber)} - ${escHtml(jobName)}`.trim();

  if (submittalType === "new") {
    return [
      emailParagraph(greeting),
      emailParagraph(
        `We are adding <strong>new paint colors</strong> to <strong>Job ${job}</strong>. Please provide brush-outs for the new colors listed below.`,
      ),
      emailParagraph(
        "The brush-outs can be delivered or shipped to our office at your convenience. Please let us know if you have any questions or need any additional information.",
      ),
      emailParagraph("<strong>New Colors Added:</strong>"),
    ].join("");
  }
  if (submittalType === "substitution") {
    return [
      emailParagraph(greeting),
      emailParagraph(
        `We need to <strong>substitute paint colors</strong> on <strong>Job ${job}</strong>. The client approved a color change for the label(s) below. Please provide brush-outs for the <strong>new colors only</strong>.`,
      ),
      `<ul style="margin: 0 0 12pt 20px; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Each row shows the <strong>previous approved color</strong> and the <strong>new replacement color</strong> for the same label/square</li>
        <li style="margin-bottom: 8px;">Please confirm product and sheen remain the same unless noted below</li>
        <li style="margin-bottom: 8px;">Let us know if you have any questions before preparing brush-outs</li>
      </ul>`,
      emailParagraph("<strong>Color Substitutions:</strong>"),
    ].join("");
  }
  if (submittalType === "revised") {
    return [
      emailParagraph(greeting),
      emailParagraph(
        `We need to <strong>revise the paint colors</strong> for <strong>Job ${job}</strong>. Please note the following:`,
      ),
      `<ul style="margin: 0 0 12pt 20px; padding-left: 20px;">
        <li style="margin-bottom: 8px;"><strong>Control samples will be dropped off</strong> at your location for color matching</li>
        <li style="margin-bottom: 8px;">Some colors may require a <strong>slight adjustment (lighter or darker)</strong> to match the approved color</li>
        <li style="margin-bottom: 8px;">Please review the revised colors below and let us know if you have any questions or concerns</li>
      </ul>`,
      emailParagraph("<strong>Revised Colors:</strong>"),
    ].join("");
  }
  return [
    emailParagraph(greeting),
    emailParagraph(
      `Can you please provide <strong>${defaultQty} brush-outs</strong> in the specified colors and sheens? You can have them delivered or shipped to our office.`,
    ),
    emailParagraph("<strong>Scope of Work:</strong>"),
  ].join("");
}

const TABLE_STYLE =
  'border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #ccc; margin-bottom: 15px;"';
const TH_STYLE = 'style="border: 1px solid #ccc; background-color: #f2f2f2;"';
const TD_STYLE = 'style="border: 1px solid #ccc;"';

function buildTablesHtml(items: PaintItem[], submittalType: TradeSubmittalType): string {
  const substitution = submittalType === "substitution";
  const filtered = items.filter((i) => i.color.trim() || i.product.trim());
  let html = "";
  let itemNum = 1;

  for (const [floor, floorItems] of groupByFloor(filtered)) {
    if (floor) {
      html += emailParagraph(`<strong>${escHtml(floor.toUpperCase())}</strong>`);
    }

    if (substitution) {
      html += `<table ${TABLE_STYLE}><thead><tr>
        <th ${TH_STYLE}>#</th><th ${TH_STYLE}>Label</th><th ${TH_STYLE}>Previous Color</th>
        <th ${TH_STYLE}>New Color</th><th ${TH_STYLE}>Product</th><th ${TH_STYLE}>Sheen</th>
      </tr></thead><tbody>`;
      for (const item of floorItems) {
        const product = escHtml(stripProductMfr(item.product));
        html += `<tr>
          <td ${TD_STYLE}>${itemNum}</td>
          <td ${TD_STYLE}>${escHtml(item.label)}</td>
          <td ${TD_STYLE}>${escHtml(item.previous_color)}</td>
          <td ${TD_STYLE}>${escHtml(item.color)}</td>
          <td ${TD_STYLE}>${product}</td>
          <td ${TD_STYLE}>${escHtml(item.sheen)}</td>
        </tr>`;
        itemNum++;
      }
    } else {
      html += `<table ${TABLE_STYLE}><thead><tr>
        <th ${TH_STYLE}>#</th><th ${TH_STYLE}>Product</th><th ${TH_STYLE}>Sheen</th>
        <th ${TH_STYLE}>Color</th><th ${TH_STYLE}>Label</th>
      </tr></thead><tbody>`;
      for (const item of floorItems) {
        const product = escHtml(stripProductMfr(item.product));
        html += `<tr>
          <td ${TD_STYLE}>${itemNum}</td>
          <td ${TD_STYLE}>${product}</td>
          <td ${TD_STYLE}>${escHtml(item.sheen)}</td>
          <td ${TD_STYLE}>${escHtml(item.color)}</td>
          <td ${TD_STYLE}>${escHtml(item.label)}</td>
        </tr>`;
        itemNum++;
      }
    }
    html += `</tbody></table>${outlookSpacer(10)}`;
  }
  return html;
}

export function buildVendorEmailPlainBody(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  items: PaintItem[],
  submittalType: TradeSubmittalType,
  defaultQty: number,
): string {
  const lines = [introPlain(vendor.name, jobNumber, jobName, submittalType, defaultQty)];
  let n = 1;
  const substitution = submittalType === "substitution";
  for (const [floor, floorItems] of groupByFloor(items.filter((i) => i.color.trim() || i.product.trim()))) {
    if (floor) lines.push(`\n${floor.toUpperCase()}`);
    for (const item of floorItems) {
      const product = stripProductMfr(item.product);
      if (substitution) {
        lines.push(
          `${n}. ${item.label} | Prev: ${item.previous_color} → New: ${item.color} | ${product} | ${item.sheen}`,
        );
      } else {
        lines.push(`${n}. ${product} | ${item.sheen} | ${item.color} | ${item.label}`);
      }
      n++;
    }
  }
  return lines.join("\n");
}

export function buildVendorEmailHtmlFragment(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  items: PaintItem[],
  submittalType: TradeSubmittalType,
  defaultQty: number,
  signature: EmailSignatureSettings,
  logoUrl = "",
): string {
  const intro = introHtml(vendor.name, jobNumber, jobName, submittalType, defaultQty);
  const tables = buildTablesHtml(items, submittalType);
  const sig = buildEmailSignatureHtml(signature, logoUrl);
  return `${intro}${tables}${sig}`;
}

export function buildVendorEmailHtmlBody(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  items: PaintItem[],
  submittalType: TradeSubmittalType,
  defaultQty: number,
  signature: EmailSignatureSettings,
  logoUrl = "",
): string {
  const fragment = buildVendorEmailHtmlFragment(
    vendor,
    jobNumber,
    jobName,
    items,
    submittalType,
    defaultQty,
    signature,
    logoUrl,
  );
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}

export function buildMailtoUrl(
  to: string[],
  cc: string[],
  subject: string,
  body = "",
): string {
  const params = new URLSearchParams();
  if (to.length) params.set("to", to.join(";"));
  if (cc.length) params.set("cc", cc.join(";"));
  params.set("subject", subject);
  if (body.trim()) params.set("body", body.slice(0, 1800));
  return `mailto:?${params.toString()}`;
}

export function vendorRecipientEmails(vendor: PaintVendor): string[] {
  return [vendor.vendor_email, vendor.store_email].filter((e): e is string => Boolean(e?.trim()));
}

function foldHeaderLine(name: string, value: string): string {
  const maxLen = 998;
  const line = `${name}: ${value}`;
  if (line.length <= maxLen) return line;
  return `${name}: ${value.slice(0, maxLen - name.length - 4)}…`;
}

/** Downloadable .eml draft — opens in classic Outlook with full HTML body. */
export function buildVendorEmlBlob(options: {
  to: string[];
  cc: string[];
  subject: string;
  htmlBody: string;
  plainBody: string;
  from?: string;
}): Blob {
  const { to, cc, subject, htmlBody, from } = options;

  const headerLines: string[] = [];
  if (from?.trim()) headerLines.push(foldHeaderLine("From", from.trim()));
  headerLines.push(foldHeaderLine("To", to.join("; ")));
  if (cc.length) headerLines.push(foldHeaderLine("Cc", cc.join("; ")));
  headerLines.push(foldHeaderLine("Subject", subject));
  headerLines.push("MIME-Version: 1.0");
  headerLines.push("Content-Type: text/html; charset=UTF-8");
  headerLines.push("Content-Transfer-Encoding: 8bit");
  headerLines.push("X-Unsent: 1");

  // Blank line after headers is required — without it Outlook shows MIME parts as plain text.
  const eml = `${headerLines.join("\r\n")}\r\n\r\n${htmlBody}\r\n`;
  return new Blob([eml], { type: "message/rfc822" });
}

export function downloadVendorEml(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyHtmlToClipboard(htmlBody: string, plainFallback: string): Promise<void> {
  const fragment = htmlBody.replace(/^[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  await copyOutlookHtmlToClipboard(fragment, plainFallback);
}

export function vendorEmlFilename(jobNumber: string, jobName: string): string {
  const safe = `${jobNumber}_${jobName}`.replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `BrushOut_${safe || "request"}.eml`;
}
