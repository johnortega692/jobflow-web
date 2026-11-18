import type { EmailSignatureSettings } from "./emailSignature";
import { buildEmailSignatureHtml, buildEmailSignaturePlain } from "./emailSignature";
import { emailParagraph } from "./outlookClipboard";
import type { PaintItem } from "../types/tradeDocuments";

export type PaintSampleOrderItem = {
  label: string;
  color: string;
  product: string;
  sheen: string;
  location: string;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(vendor: string): string {
  return vendor.trim().split(/\s+/)[0] || "Team";
}

export function buildPaintSampleOrderSubject(jobNumber: string, jobName: string): string {
  return `Sample request | ${jobNumber} ${jobName}`.trim();
}

export function paintSampleOrderItems(items: PaintItem[], includeLocation: boolean): PaintSampleOrderItem[] {
  return items
    .filter((item) => item.color.trim() || item.product.trim())
    .map((item) => ({
      label: item.label.trim(),
      color: item.color.trim(),
      product: item.product.trim(),
      sheen: item.sheen.trim(),
      location: includeLocation ? item.floor.trim() : "",
    }));
}

export type PaintSampleOrderEmailParams = {
  vendor: string;
  jobNumber: string;
  jobName: string;
  jobLocation: string;
  architect: string;
  specifierAddress: string;
  qty: number;
  shippingAddress: string;
  pmName: string;
  items: PaintSampleOrderItem[];
  signature?: EmailSignatureSettings;
  logoUrl?: string;
};

function formatSpecifierLine(architect: string, specifierAddress: string): string {
  const name = architect.trim() || "TBD";
  if (!architect.trim()) return `${name} - TBD`;
  if (specifierAddress.trim()) return `${name} - ${specifierAddress.trim()}`;
  return `${name} - TBD`;
}

function jobInfoPlain(params: PaintSampleOrderEmailParams): string[] {
  return [
    "Project Information",
    `• Job Number: ${params.jobNumber}`,
    `• Project Name: ${params.jobName}`,
    `• Job Location: ${params.jobLocation.trim() || "TBD"}`,
    `• Specifier: ${formatSpecifierLine(params.architect, params.specifierAddress)}`,
  ];
}

function jobInfoHtml(params: PaintSampleOrderEmailParams): string {
  return (
    `Project Information<br>` +
    `• Job Number: ${escHtml(params.jobNumber)}<br>` +
    `• Project Name: ${escHtml(params.jobName)}<br>` +
    `• Job Location: ${escHtml(params.jobLocation.trim() || "TBD")}<br>` +
    `• Specifier: ${escHtml(formatSpecifierLine(params.architect, params.specifierAddress))}`
  );
}

function qtyLine(qty: number): string {
  const count = Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1;
  return count === 1 ? "1 mailed sample of each color" : `${count} mailed samples of each color`;
}

function itemPlain(item: PaintSampleOrderItem, index: number): string {
  const parts = [
    item.label,
    item.color || "Color",
    item.product,
    item.sheen,
    item.location,
  ].filter(Boolean);
  return `${index}. ${parts.join(" — ")}`;
}

export function buildPaintSampleOrderPlainBody(params: PaintSampleOrderEmailParams): string {
  const shipping = params.shippingAddress.trim() || "[Please provide an address for sample delivery]";
  const lines = [
    `Hi ${firstName(params.vendor)},`,
    "",
    `Please mail samples for Job ${params.jobNumber} ${params.jobName}. These are mailed samples, not brush-outs.`,
    "",
    ...jobInfoPlain(params),
    "",
    `Please send ${qtyLine(params.qty)}.`,
    "",
    "Colors requested:",
    "",
    ...params.items.map((item, index) => itemPlain(item, index + 1)),
    "",
    "Please ship the samples to:",
    `Attn: ${params.pmName.trim() || "PM"}`,
    shipping,
    "",
    "Please let us know the lead time for these samples.",
    "",
    "Thank you,",
  ];
  if (params.signature) lines.push("", buildEmailSignaturePlain(params.signature));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPaintSampleOrderHtmlBody(params: PaintSampleOrderEmailParams): string {
  const shipping = params.shippingAddress.trim() || "[Please provide an address for sample delivery]";
  const locationHeader = params.items.some((item) => item.location.trim()) ? "<th style=\"padding:4px 8px;border:1px solid #d0d0d0;text-align:left;\">Location</th>" : "";
  const rows = params.items
    .map((item) => {
      const shown = params.items.some((row) => row.location.trim()) ? item : { ...item, location: "" };
      const cells = [shown.label, shown.color, shown.product, shown.sheen];
      if (locationHeader) cells.push(shown.location);
      return `<tr>${cells
        .map((value) => `<td style="padding:4px 8px;border:1px solid #d0d0d0;">${escHtml(value) || "—"}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  const table =
    `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;">` +
    `<thead><tr>` +
    `<th style="padding:4px 8px;border:1px solid #d0d0d0;text-align:left;">Label</th>` +
    `<th style="padding:4px 8px;border:1px solid #d0d0d0;text-align:left;">Color</th>` +
    `<th style="padding:4px 8px;border:1px solid #d0d0d0;text-align:left;">Product</th>` +
    `<th style="padding:4px 8px;border:1px solid #d0d0d0;text-align:left;">Sheen</th>` +
    locationHeader +
    `</tr></thead><tbody>${rows}</tbody></table>`;

  let fragment =
    emailParagraph(`Hi ${escHtml(firstName(params.vendor))},`) +
    emailParagraph(
      `Please mail samples for <strong>Job ${escHtml(params.jobNumber)} ${escHtml(params.jobName)}</strong>. These are mailed samples, not brush-outs.`,
    ) +
    emailParagraph(jobInfoHtml(params)) +
    emailParagraph(`Please send <strong>${escHtml(qtyLine(params.qty))}</strong>.`) +
    emailParagraph("<strong>Colors requested</strong>") +
    table +
    emailParagraph(
      `Please ship the samples to:<br>Attn: ${escHtml(params.pmName.trim() || "PM")}<br>${escHtml(shipping).replace(/\n/g, "<br>")}`,
    ) +
    emailParagraph("Please let us know the lead time for these samples.") +
    emailParagraph("Thank you,");

  if (params.signature) {
    fragment += buildEmailSignatureHtml(params.signature, params.logoUrl ?? "");
  }
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}
