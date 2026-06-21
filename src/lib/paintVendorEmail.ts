import { buildEmailSignatureHtml, buildEmailSignaturePlain } from "./emailSignature";
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

export type AtticStockPaintItem = PaintItem & { qty: string };
export type AtticStockCustomItem = { description: string; qty: string };

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

export function buildAtticStockEmailSubject(jobNumber: string, jobName: string): string {
  return `Attic Stock Order | ${jobNumber} ${jobName}`.trim();
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

export const PREP_SITE_LABELS_SUFFIX =
  "(labels TBD — job name/number to follow)";

export function buildPrepEmailSubject(siteLocation: string): string {
  const site = siteLocation.trim() || "site TBD";
  return `Brush-out request — colors per schedule (official job # to follow) — ${site}`;
}

function introPrepPlain(vendorName: string, siteLocation: string, gc: string, defaultQty: number): string[] {
  const first = vendorFirstName(vendorName);
  const lines = [
    `Hi ${first},`,
    "",
    "Important: Our office has NOT assigned the official job number or project name yet.",
    "Please use the color list below for this brush-out request. When our office assigns the job, we will reply to this email with the official job number and name so you can label the brush-outs.",
    "",
  ];
  if (siteLocation.trim()) lines.push(PREP_SITE_LABELS_SUFFIX, "");
  if (gc.trim()) lines.push(`GC: ${gc.trim()}`, "");
  lines.push(
    `Can you please provide ${defaultQty} brush-outs in the specified colors and sheens? You can have them delivered or shipped to our office.`,
    "",
    "Colors requested:",
  );
  return lines;
}

function introPrepHtml(
  vendorName: string,
  siteLocation: string,
  gc: string,
  defaultQty: number,
): string {
  const greeting = `Hi ${escHtml(vendorFirstName(vendorName))},`;
  let context = "";
  if (siteLocation.trim()) {
    context += emailParagraph(PREP_SITE_LABELS_SUFFIX);
  }
  if (gc.trim()) {
    context += emailParagraph(`<strong>GC:</strong> ${escHtml(gc.trim())}`);
  }
  return [
    emailParagraph(greeting),
    emailParagraph(
      "<strong>Important:</strong> Our office has <strong>not</strong> assigned the official job number or project name yet. Please use the color list below for this brush-out request. When our office assigns the job, we will <strong>reply to this email</strong> with the official job number and name so you can label the brush-outs.",
    ),
    context,
    emailParagraph(
      `Can you please provide <strong>${defaultQty} brush-outs</strong> in the specified colors and sheens? You can have them delivered or shipped to our office.`,
    ),
    emailParagraph("<strong>Colors requested:</strong>"),
  ].join("");
}

export function buildPrepEmailPlainBody(
  vendor: PaintVendor,
  siteLocation: string,
  gc: string,
  items: PaintItem[],
  defaultQty: number,
  signature?: EmailSignatureSettings,
): string {
  const parts = [
    ...introPrepPlain(vendor.name, siteLocation, gc, defaultQty),
    "",
    ...buildPlainItemTables(items, "original"),
  ];
  if (signature) parts.push("", buildEmailSignaturePlain(signature));
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPrepEmailHtmlBody(
  vendor: PaintVendor,
  siteLocation: string,
  gc: string,
  items: PaintItem[],
  defaultQty: number,
  signature: EmailSignatureSettings,
  logoUrl = "",
): string {
  const intro = introPrepHtml(vendor.name, siteLocation, gc, defaultQty);
  const tables = buildTablesHtml(items, "original");
  const sig = buildEmailSignatureHtml(signature, logoUrl);
  const fragment = `${intro}${tables}${sig}`;
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}

export function prepEmlFilename(siteLocation: string): string {
  const safe = siteLocation.replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `BrushOut_prep_${safe || "request"}.eml`;
}

export function vendorDisplayName(vendor: PaintVendor): string {
  return `${vendor.name} (${vendor.brand})`.trim();
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
): string[] {
  const first = vendorFirstName(vendorName);
  const job = `${jobNumber} - ${jobName}`.trim();

  if (submittalType === "new") {
    return [
      `Hi ${first},`,
      "",
      `We are adding new paint colors to Job ${job}. Please provide brush-outs for the new colors listed below.`,
      "",
      "The brush-outs can be delivered or shipped to our office at your convenience. Please let us know if you have any questions or need any additional information.",
      "",
      "New Colors Added:",
    ];
  }
  if (submittalType === "substitution") {
    return [
      `Hi ${first},`,
      "",
      `We need to substitute paint colors on Job ${job}. The client approved a color change for the label(s) below. Please provide brush-outs for the new colors only.`,
      "",
      "  • Each row shows the previous approved color and the new replacement color for the same label/square",
      "  • Please confirm product and sheen remain the same unless noted below",
      "  • Let us know if you have any questions before preparing brush-outs",
      "",
      "Color Substitutions:",
    ];
  }
  if (submittalType === "revised") {
    return [
      `Hi ${first},`,
      "",
      `We need to revise the paint colors for Job ${job}. Please note the following:`,
      "",
      "  • Control samples will be dropped off at your location for color matching",
      "  • Some colors may require a slight adjustment (lighter or darker) to match the approved color",
      "  • Please review the revised colors below and let us know if you have any questions or concerns",
      "",
      "Revised Colors:",
    ];
  }
  return [
    `Hi ${first},`,
    "",
    `Can you please provide ${defaultQty} brush-outs in the specified colors and sheens? You can have them delivered or shipped to our office.`,
    "",
    "Scope of Work:",
  ];
}

function plainColumnWidths(headers: string[], rows: string[][], min = 2, max = 26): number[] {
  return headers.map((header, i) => {
    const longest = Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length));
    return Math.max(min, Math.min(max, longest));
  });
}

function plainFormatRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, i) => {
      const width = widths[i] ?? 8;
      return (cell ?? "").slice(0, width).padEnd(width);
    })
    .join("  ");
}

function buildPlainItemTable(
  floorItems: PaintItem[],
  submittalType: TradeSubmittalType,
  startNum: number,
): { text: string; nextNum: number } {
  const substitution = submittalType === "substitution";
  const filtered = floorItems.filter((i) => i.color.trim() || i.product.trim());
  if (!filtered.length) return { text: "", nextNum: startNum };

  const headers = substitution
    ? ["#", "Label", "Previous", "New Color", "Product", "Sheen"]
    : ["#", "Product", "Sheen", "Color", "Label"];

  const rows: string[][] = [];
  let n = startNum;
  for (const item of filtered) {
    const product = stripProductMfr(item.product);
    if (substitution) {
      rows.push([
        String(n),
        item.label,
        item.previous_color,
        item.color,
        product,
        item.sheen,
      ]);
    } else {
      rows.push([String(n), product, item.sheen, item.color, item.label]);
    }
    n += 1;
  }

  const widths = plainColumnWidths(headers, rows);
  const rule = widths.map((w) => "-".repeat(w)).join("  ");

  return {
    text: [plainFormatRow(headers, widths), rule, ...rows.map((row) => plainFormatRow(row, widths))].join(
      "\n",
    ),
    nextNum: n,
  };
}

function buildPlainItemTables(
  items: PaintItem[],
  submittalType: TradeSubmittalType,
): string[] {
  const blocks: string[] = [];
  let itemNum = 1;

  for (const [floor, floorItems] of groupByFloor(items.filter((i) => i.color.trim() || i.product.trim()))) {
    if (floor) {
      blocks.push("", floor.toUpperCase(), "");
    }
    const table = buildPlainItemTable(floorItems, submittalType, itemNum);
    if (table.text) {
      blocks.push(table.text);
      itemNum = table.nextNum;
    }
  }

  return blocks;
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

function introAtticStockPlain(vendorName: string, jobNumber: string, jobName: string): string[] {
  const first = vendorFirstName(vendorName);
  const job = `${jobNumber} - ${jobName}`.trim();
  return [
    `Hi ${first},`,
    "",
    `Please provide attic stock paint for the following items for Job ${job}, and let us know when these will be ready or if you need anything further from us.`,
    "",
    "Attic Stock Items:",
  ];
}

function introAtticStockHtml(vendorName: string, jobNumber: string, jobName: string): string {
  const greeting = `Hi ${escHtml(vendorFirstName(vendorName))},`;
  const job = `${escHtml(jobNumber)} - ${escHtml(jobName)}`.trim();
  return [
    emailParagraph(greeting),
    emailParagraph(
      `Please provide <strong>attic stock paint</strong> for the following items for <strong>Job ${job}</strong>, and let us know when these will be ready or if you need anything further from us.`,
    ),
    emailParagraph("<strong>Attic Stock Items:</strong>"),
  ].join("");
}

function buildAtticStockPlainTable(
  paintItems: AtticStockPaintItem[],
  customItems: AtticStockCustomItem[],
): string {
  const headers = ["#", "Product", "Sheen", "Color", "Label", "Qty"];
  const rows: string[][] = [];
  let n = 1;

  for (const item of paintItems.filter((i) => i.color.trim() || i.product.trim())) {
    rows.push([
      String(n),
      stripProductMfr(item.product),
      item.sheen,
      item.color,
      item.label,
      item.qty,
    ]);
    n += 1;
  }
  for (const custom of customItems) {
    rows.push([String(n), custom.description, "", "", "", custom.qty]);
    n += 1;
  }

  if (!rows.length) return "";
  const widths = plainColumnWidths(headers, rows);
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [plainFormatRow(headers, widths), rule, ...rows.map((row) => plainFormatRow(row, widths))].join(
    "\n",
  );
}

function buildAtticStockTableHtml(
  paintItems: AtticStockPaintItem[],
  customItems: AtticStockCustomItem[],
): string {
  let html = `<table ${TABLE_STYLE}><thead><tr>
    <th ${TH_STYLE}>#</th><th ${TH_STYLE}>Product</th><th ${TH_STYLE}>Sheen</th>
    <th ${TH_STYLE}>Color</th><th ${TH_STYLE}>Label</th><th ${TH_STYLE}>Qty</th>
  </tr></thead><tbody>`;
  let itemNum = 1;

  for (const item of paintItems.filter((i) => i.color.trim() || i.product.trim())) {
    const product = escHtml(stripProductMfr(item.product));
    html += `<tr>
      <td ${TD_STYLE}>${itemNum}</td>
      <td ${TD_STYLE}>${product}</td>
      <td ${TD_STYLE}>${escHtml(item.sheen)}</td>
      <td ${TD_STYLE}>${escHtml(item.color)}</td>
      <td ${TD_STYLE}>${escHtml(item.label)}</td>
      <td ${TD_STYLE}>${escHtml(item.qty)}</td>
    </tr>`;
    itemNum += 1;
  }
  for (const custom of customItems) {
    html += `<tr>
      <td ${TD_STYLE}>${itemNum}</td>
      <td colspan="4" ${TD_STYLE}>${escHtml(custom.description)}</td>
      <td ${TD_STYLE}>${escHtml(custom.qty)}</td>
    </tr>`;
    itemNum += 1;
  }

  html += `</tbody></table>${outlookSpacer(10)}`;
  return html;
}

export function buildAtticStockEmailPlainBody(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  paintItems: AtticStockPaintItem[],
  customItems: AtticStockCustomItem[],
  signature?: EmailSignatureSettings,
): string {
  const parts = [
    ...introAtticStockPlain(vendor.name, jobNumber, jobName),
    "",
    buildAtticStockPlainTable(paintItems, customItems),
  ];
  if (signature) {
    parts.push("", buildEmailSignaturePlain(signature));
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildAtticStockEmailHtmlFragment(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  paintItems: AtticStockPaintItem[],
  customItems: AtticStockCustomItem[],
  signature: EmailSignatureSettings,
  logoUrl = "",
): string {
  const intro = introAtticStockHtml(vendor.name, jobNumber, jobName);
  const table = buildAtticStockTableHtml(paintItems, customItems);
  const sig = buildEmailSignatureHtml(signature, logoUrl);
  return `${intro}${table}${sig}`;
}

export function buildAtticStockEmailHtmlBody(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  paintItems: AtticStockPaintItem[],
  customItems: AtticStockCustomItem[],
  signature: EmailSignatureSettings,
  logoUrl = "",
): string {
  const fragment = buildAtticStockEmailHtmlFragment(
    vendor,
    jobNumber,
    jobName,
    paintItems,
    customItems,
    signature,
    logoUrl,
  );
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}

export function buildVendorEmailPlainBody(
  vendor: PaintVendor,
  jobNumber: string,
  jobName: string,
  items: PaintItem[],
  submittalType: TradeSubmittalType,
  defaultQty: number,
  signature?: EmailSignatureSettings,
): string {
  const parts = [
    ...introPlain(vendor.name, jobNumber, jobName, submittalType, defaultQty),
    "",
    ...buildPlainItemTables(items, submittalType),
  ];

  if (signature) {
    parts.push("", buildEmailSignaturePlain(signature));
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

/** Outlook / browser mailto links truncate around 2–8 KB; keep a safe upper bound. */
export const MAILTO_BODY_MAX_CHARS = 7500;

export function buildMailtoUrl(
  to: string[],
  cc: string[],
  subject: string,
  body = "",
): string {
  const params: string[] = [];
  if (to.length) params.push(`to=${encodeURIComponent(to.join(";"))}`);
  if (cc.length) params.push(`cc=${encodeURIComponent(cc.join(";"))}`);
  params.push(`subject=${encodeURIComponent(subject)}`);
  const bodyText = body.trim();
  if (bodyText) params.push(`body=${encodeURIComponent(bodyText.slice(0, MAILTO_BODY_MAX_CHARS))}`);
  return `mailto:?${params.join("&")}`;
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

export function atticStockEmlFilename(jobNumber: string, jobName: string): string {
  const safe = `${jobNumber}_${jobName}`.replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `AtticStock_${safe || "order"}.eml`;
}
