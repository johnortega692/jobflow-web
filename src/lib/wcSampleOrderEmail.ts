import type { FrpItem, WallcoveringItem } from "../types/tradeDocuments";
import type { EmailSignatureSettings } from "./emailSignature";
import { buildEmailSignatureHtml, buildEmailSignaturePlain } from "./emailSignature";
import { emailParagraph } from "./outlookClipboard";

export type SampleItemScope = "Wallcovering" | "FRP";

export type WcSampleOrderItem = {
  scope: SampleItemScope;
  manufacturer: string;
  product: string;
  color: string;
  /** Wallcovering qty, or FRP label */
  qtyOrLabel: string;
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(vendor: string): string {
  const word = vendor.trim().split(/\s+/)[0];
  return word || "Team";
}

export function sampleOrderGreeting(vendorName: string): string {
  const name = vendorName.trim();
  if (!name) return "Dear Team,";
  return `Dear ${firstName(name)},`;
}

export function buildWcSampleOrderSubject(jobNumber: string, jobName: string): string {
  return `Sample Request - Project ${jobNumber} ${jobName}`.trim();
}

function formatSpecifierLine(architect: string, specifierAddress: string): string {
  const name = architect.trim() || "TBD";
  if (!architect.trim()) return `${name} - TBD`;
  if (specifierAddress.trim()) return `${name} - ${specifierAddress.trim()}`;
  return `${name} - TBD`;
}

function formatItemPlain(item: WcSampleOrderItem, index: number): string {
  const prefix = item.scope === "Wallcovering" ? "" : `[${item.scope}] `;
  let line = `${index}. ${prefix}${item.manufacturer} - `;
  if (item.color.trim()) line += `${item.product} - Color: ${item.color}`;
  else line += item.product;
  if (item.scope === "Wallcovering" && item.qtyOrLabel.trim()) {
    line += ` (QTY: ${item.qtyOrLabel.trim()})`;
  } else if (item.scope === "FRP" && item.qtyOrLabel.trim()) {
    line += ` (Label: ${item.qtyOrLabel.trim()})`;
  }
  return line;
}

function formatItemHtml(item: WcSampleOrderItem, index: number): string {
  const typeTag =
    item.scope === "Wallcovering" ? "" : `<strong>[${escHtml(item.scope)}]</strong> `;
  let line = `${index}. ${typeTag}${escHtml(item.manufacturer)} - `;
  if (item.color.trim()) {
    line += `${escHtml(item.product)} - Color: ${escHtml(item.color)}`;
  } else {
    line += escHtml(item.product);
  }
  if (item.scope === "Wallcovering" && item.qtyOrLabel.trim()) {
    line += ` (QTY: ${escHtml(item.qtyOrLabel.trim())})`;
  } else if (item.scope === "FRP" && item.qtyOrLabel.trim()) {
    line += ` (Label: ${escHtml(item.qtyOrLabel.trim())})`;
  }
  return line;
}

export type SampleOrderEmailParams = {
  vendor: string;
  jobNumber: string;
  jobName: string;
  jobLocation: string;
  architect: string;
  specifierAddress: string;
  shippingAddress: string;
  /** ICBI PM from Job Setup — used for Attn: on ship-to block. */
  pmName: string;
  items: WcSampleOrderItem[];
  signature?: EmailSignatureSettings;
  logoUrl?: string;
};

export function buildWcSampleOrderPlainBody(params: SampleOrderEmailParams): string {
  const greeting = sampleOrderGreeting(params.vendor);
  const shipping =
    params.shippingAddress.trim() || "[Please provide address for sample delivery]";
  const lines: string[] = [
    greeting,
    "",
    `I hope this email finds you well. We have been awarded Project ${params.jobNumber} - ${params.jobName} and would like to request material samples.`,
    "",
    "Requested Items",
    "",
  ];

  params.items.forEach((item, i) => {
    lines.push(formatItemPlain(item, i + 1));
  });

  lines.push(
    "",
    "(Quantity: 6 samples each)",
    "",
    "Project Information",
    `• Job Number: ${params.jobNumber}`,
    `• Project Name: ${params.jobName}`,
    `• Job Location: ${params.jobLocation.trim() || "TBD"}`,
    `• Specifier: ${formatSpecifierLine(params.architect, params.specifierAddress)}`,
    "",
    "Please ship samples to the following:",
    "",
    `Attn: ${params.pmName.trim() || "PM"}`,
    shipping,
    "",
    "Lead Time",
    "Could you please provide the current lead time for the requested material? If the lead time varies based on the requested quantity, please include the estimated lead time for the quantities listed above.",
  );

  lines.push(
    "",
    "Please let me know if you need any additional information to process this request. We appreciate your assistance and look forward to working with you on this project.",
    "",
    "Best regards,",
  );

  if (params.signature) {
    lines.push("", buildEmailSignaturePlain(params.signature));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildWcSampleOrderHtmlBody(params: SampleOrderEmailParams): string {
  const greeting = sampleOrderGreeting(params.vendor);
  const shipping =
    params.shippingAddress.trim() || "[Please provide address for sample delivery]";
  const shippingHtml = escHtml(shipping).replace(/\n/g, "<br>");

  let fragment =
    emailParagraph(escHtml(greeting)) +
    emailParagraph(
      `I hope this email finds you well. We have been awarded Project ${escHtml(params.jobNumber)} - ${escHtml(params.jobName)} and would like to request material samples.`,
    ) +
    emailParagraph("<strong>Requested Items</strong>");

  params.items.forEach((item, i) => {
    fragment += emailParagraph(formatItemHtml(item, i + 1));
  });

  fragment += emailParagraph("(Quantity: 6 samples each)");

  fragment += emailParagraph(
    `Project Information<br>
• Job Number: ${escHtml(params.jobNumber)}<br>
• Project Name: ${escHtml(params.jobName)}<br>
• Job Location: ${escHtml(params.jobLocation.trim() || "TBD")}<br>
• Specifier: ${escHtml(formatSpecifierLine(params.architect, params.specifierAddress))}`,
  );

  fragment += emailParagraph(
    `Please ship samples to the following:<br>Attn: ${escHtml(params.pmName.trim() || "PM")}<br>${shippingHtml}`,
  );

  fragment += emailParagraph(
    "<strong>Lead Time</strong><br>Could you please provide the current lead time for the requested material? If the lead time varies based on the requested quantity, please include the estimated lead time for the quantities listed above.",
  );

  fragment += emailParagraph(
    "Please let me know if you need any additional information to process this request. We appreciate your assistance and look forward to working with you on this project.",
  );
  fragment += emailParagraph("Best regards,");

  if (params.signature) {
    fragment += buildEmailSignatureHtml(params.signature, params.logoUrl ?? "");
  }

  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}

/** @deprecated Prefer buildWcSampleOrderPlainBody + buildWcSampleOrderSubject */
export function buildWcSampleOrderEmail(params: {
  vendor: string;
  jobNumber: string;
  jobName: string;
  architect: string;
  shippingAddress: string;
  items: WcSampleOrderItem[];
  jobLocation?: string;
  specifierAddress?: string;
  pmName?: string;
}): { subject: string; body: string } {
  return {
    subject: buildWcSampleOrderSubject(params.jobNumber, params.jobName),
    body: buildWcSampleOrderPlainBody({
      vendor: params.vendor,
      jobNumber: params.jobNumber,
      jobName: params.jobName,
      jobLocation: params.jobLocation ?? "",
      architect: params.architect,
      specifierAddress: params.specifierAddress ?? "",
      shippingAddress: params.shippingAddress,
      pmName: params.pmName ?? "",
      items: params.items,
    }),
  };
}

export function orderedWallcoveringItems(items: WallcoveringItem[]): WcSampleOrderItem[] {
  return items
    .filter((i) => i.order && (i.manufacturer.trim() || i.product.trim() || i.color.trim()))
    .map((i) => ({
      scope: "Wallcovering" as const,
      manufacturer: i.manufacturer,
      product: i.product,
      color: i.color,
      qtyOrLabel: i.qty,
    }));
}

export function orderedFrpItems(items: FrpItem[]): WcSampleOrderItem[] {
  return items
    .filter((i) => i.order && (i.manufacturer.trim() || i.product.trim() || i.color.trim()))
    .map((i) => ({
      scope: "FRP" as const,
      manufacturer: i.manufacturer,
      product: i.product,
      color: i.color,
      qtyOrLabel: i.label,
    }));
}

export const WC_SHIPPING_ADDRESS_KEY = "jobflow_wc_shipping_address";

export function loadWcShippingAddress(): string {
  try {
    return localStorage.getItem(WC_SHIPPING_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveWcShippingAddress(address: string): void {
  try {
    localStorage.setItem(WC_SHIPPING_ADDRESS_KEY, address);
  } catch {
    /* ignore */
  }
}
