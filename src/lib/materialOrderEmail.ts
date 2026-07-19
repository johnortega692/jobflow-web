import type { DeliverySchedulingSettings } from "./deliverySettings";
import type { EmailSignatureSettings } from "./emailSignature";
import { buildEmailSignatureHtml, buildEmailSignaturePlain } from "./emailSignature";
import { emailParagraph } from "./outlookClipboard";

export type MaterialOrderEmailItem = {
  manufacturer: string;
  product: string;
  color: string;
  quantity: string;
  label: string;
  notes: string;
};

export type MaterialOrderEmailType = "Wallcovering" | "FRP" | "Material" | "FWP";

export type MaterialOrderEmailParams = {
  materialType: MaterialOrderEmailType;
  jobNumber: string;
  jobName: string;
  /** Allocated PO from delivery step, when available. */
  poNumber: string;
  deliveryAddress: string;
  specifier: string;
  manufacturer: string;
  items: MaterialOrderEmailItem[];
  delivery: DeliverySchedulingSettings;
  signature?: EmailSignatureSettings;
  logoUrl?: string;
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatItemLine(item: MaterialOrderEmailItem): string {
  let line = item.label.trim() ? `${item.label.trim()} - ${item.product}` : item.product;
  if (item.color.trim()) line += ` ${item.color.trim()}`;
  if (item.quantity.trim()) line += `: ${item.quantity.trim()}`;
  if (item.notes.trim()) line += ` (Notes: ${item.notes.trim()})`;
  return line;
}

function poLabel(poNumber: string): string {
  return poNumber.trim() || "TBD";
}

function projectNameWithJob(jobNumber: string, jobName: string): string {
  const job = jobNumber.trim();
  const name = jobName.trim();
  if (job && name) return `${job} - ${name}`;
  return name || job || "TBD";
}

export function buildMaterialOrderEmailSubject(
  materialType: MaterialOrderEmailType,
  jobNumber: string,
  jobName: string,
): string {
  return `${materialType} Order - ${jobNumber.trim()} - ${jobName.trim()}`.trim();
}

export function resolveMaterialOrderEmailType(hasWc: boolean, hasFrp: boolean): MaterialOrderEmailType {
  if (hasWc && hasFrp) return "Material";
  if (hasFrp) return "FRP";
  return "Wallcovering";
}

export function buildMaterialOrderEmailPlainBody(params: MaterialOrderEmailParams): string {
  const ds = params.delivery;
  const lines: string[] = [
    "Hi,",
    "",
    "I hope this message finds you well.",
    "",
    `Please process the attached order for the ${params.materialType.toLowerCase()} materials required for our project. Below are the details for your reference:`,
    "",
    `• PO #: ${poLabel(params.poNumber)}`,
    `• Project Name: ${projectNameWithJob(params.jobNumber, params.jobName)}`,
    `• Delivery Address: ${params.deliveryAddress.trim() || "TBD"}`,
    `• Specifier: ${params.specifier.trim() || "TBD"}`,
    `• Manufacturer: ${params.manufacturer.trim() || "TBD"}`,
    "",
    "Materials Ordered:",
    "",
  ];

  for (const item of params.items) {
    lines.push(`• ${formatItemLine(item)}`);
  }

  lines.push(
    "",
    "Delivery Scheduling Information:",
    "",
    "• Warehouse Contact Info:",
    `  - ${ds.warehouse_contact_name} - ${ds.warehouse_contact_email} - Cell: ${ds.warehouse_contact_cell}`,
    `  - Main Office: ${ds.warehouse_main_office}`,
    `• Receiving Hours: ${ds.receiving_hours}`,
    `• Dock Restrictions: ${ds.dock_restrictions}`,
    `• Is a lift gate needed? ${ds.lift_gate_needed}`,
    "",
    ds.closing_note.trim() ||
      "We kindly request confirmation of this order and an update on the expected delivery timeline at your earliest convenience. Should you require any additional details, feel free to contact me directly.",
    "",
    "Thank you for your prompt attention to this order. I look forward to hearing back from you.",
  );

  if (params.signature) {
    lines.push("", buildEmailSignaturePlain(params.signature));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildMaterialOrderEmailHtmlBody(params: MaterialOrderEmailParams): string {
  const ds = params.delivery;
  const itemLis = params.items
    .map((item) => `    <li>${escHtml(formatItemLine(item))}</li>`)
    .join("\n");

  const closing =
    ds.closing_note.trim() ||
    "We kindly request confirmation of this order and an update on the expected delivery timeline at your earliest convenience. Should you require any additional details, feel free to contact me directly.";

  let fragment =
    emailParagraph("Hi,") +
    emailParagraph("I hope this message finds you well.") +
    emailParagraph(
      `Please process the attached order for the ${escHtml(params.materialType.toLowerCase())} materials required for our project. Below are the details for your reference:`,
    ) +
    emailParagraph(
      `<ul style="margin:0;padding-left:1.25rem;">
    <li><strong>PO #:</strong> ${escHtml(poLabel(params.poNumber))}</li>
    <li><strong>Project Name:</strong> ${escHtml(projectNameWithJob(params.jobNumber, params.jobName))}</li>
    <li><strong>Delivery Address:</strong> ${escHtml(params.deliveryAddress.trim() || "TBD")}</li>
    <li><strong>Specifier:</strong> ${escHtml(params.specifier.trim() || "TBD")}</li>
    <li><strong>Manufacturer:</strong> ${escHtml(params.manufacturer.trim() || "TBD")}</li>
</ul>`,
    ) +
    emailParagraph("<strong>Materials Ordered:</strong>") +
    emailParagraph(`<ul style="margin:0;padding-left:1.25rem;">\n${itemLis}\n</ul>`) +
    emailParagraph("<strong>Delivery Scheduling Information:</strong>") +
    emailParagraph(
      `<ul style="margin:0;padding-left:1.25rem;">
    <li><strong>Warehouse Contact Info:</strong>
        <ul style="margin:0.25rem 0 0;padding-left:1.25rem;">
            <li>${escHtml(ds.warehouse_contact_name)} - ${escHtml(ds.warehouse_contact_email)} - Cell: ${escHtml(ds.warehouse_contact_cell)}</li>
            <li>Main Office: ${escHtml(ds.warehouse_main_office)}</li>
        </ul>
    </li>
    <li><strong>Receiving Hours:</strong> ${escHtml(ds.receiving_hours)}</li>
    <li><strong>Dock Restrictions:</strong> ${escHtml(ds.dock_restrictions)}</li>
    <li><strong>Is a lift gate needed?</strong> ${escHtml(ds.lift_gate_needed)}</li>
</ul>`,
    ) +
    emailParagraph(escHtml(closing)) +
    emailParagraph("Thank you for your prompt attention to this order. I look forward to hearing back from you.");

  if (params.signature) {
    fragment += buildEmailSignatureHtml(params.signature, params.logoUrl ?? "");
  }

  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #333;">${fragment}</body></html>`;
}
