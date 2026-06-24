import {
  emptyEnclosure,
  normalizeEnclosure,
  normalizePendingItem,
  paintItemToTransmittalDescription,
  wallcoveringItemToTransmittalDescription,
  type PaintItem,
  type PendingSubmittalItem,
  type ProjectTradeData,
  type TransmittalData,
  type TransmittalEnclosure,
  type WallcoveringItem,
} from "../types/tradeDocuments";
import { esc, formatLongDate } from "./printCore";
import {
  openGmailComposeWithHtml,
  copyHtmlToClipboard,
  type OpenMailtoResult,
  type AtticStockCustomItem,
  type AtticStockPaintItem,
} from "./paintVendorEmail";
import type { ComposeEmailMethod } from "./paintUserSettings";

export function enclosureOutputDescription(row: TransmittalEnclosure): string {
  const base = row.description.trim();
  if (!row.digital_copy) return base;
  return base ? `${base} (Digital Copy)` : "(Digital Copy)";
}

export function pendingItemEnclosureDescription(item: PendingSubmittalItem): string {
  const normalized = normalizePendingItem(item);
  const source = normalized.source.trim();
  if (source === "sds_packet") {
    const spec = normalized.spec_section.trim();
    const packet = normalized.packet_type.trim();
    if (spec && packet) return `${spec} · ${packet}`;
    return spec || packet || "Product Data";
  }
  if (source === "paint_submittal") {
    const stype = normalized.submittal_type.trim();
    return stype ? `${stype} · Paint` : "Color Samples · Paint";
  }
  if (source === "wallcovering_submittal") {
    const stype = normalized.submittal_type.trim();
    return stype ? `${stype} · Wallcovering` : "Color Samples · Wallcovering";
  }
  if (source === "frp_submittal") {
    const stype = normalized.submittal_type.trim();
    return stype ? `${stype} · FRP` : "Product Data · FRP";
  }
  const scope = normalized.scope.trim();
  const stype = normalized.submittal_type.trim();
  if (scope && stype) return `${stype} · ${scope}`;
  return stype || scope || "Submittal package";
}

export function pendingItemLabel(item: PendingSubmittalItem): string {
  return pendingItemEnclosureDescription(item);
}

export function queuePendingItem(
  transmittal: TransmittalData,
  item: Partial<PendingSubmittalItem>,
): TransmittalData {
  const normalized = normalizePendingItem(item);
  const queue = [...(transmittal.pending_submittal_queue ?? []), normalized];
  return {
    ...transmittal,
    pending_submittal_queue: queue,
    cb_product_data:
      transmittal.cb_product_data ||
      normalized.submittal_type === "Product Data" ||
      normalized.source === "sds_packet",
    cb_sds_safety:
      transmittal.cb_sds_safety ||
      normalized.source === "sds_packet" ||
      normalized.packet_type.toLowerCase().includes("sds"),
    cb_submittal: true,
    cb_samples:
      transmittal.cb_samples ||
      normalized.submittal_type.toLowerCase().includes("color") ||
      normalized.submittal_type.toLowerCase().includes("sample"),
  };
}

function enclosurePendingIds(enclosures: TransmittalEnclosure[]): Set<string> {
  return new Set(enclosures.map((e) => e.pending_id).filter(Boolean) as string[]);
}

export function appendPendingToEnclosures(
  transmittal: TransmittalData,
  indices: number[],
): { transmittal: TransmittalData; added: number; skipped: number } {
  const queue = transmittal.pending_submittal_queue ?? [];
  if (!queue.length || !indices.length) {
    return { transmittal, added: 0, skipped: 0 };
  }
  const usedPending = enclosurePendingIds(transmittal.enclosures);
  let added = 0;
  let skipped = 0;
  const newEnclosures = [...transmittal.enclosures.filter((e) => e.description.trim())];
  for (const idx of [...new Set(indices)].sort((a, b) => a - b)) {
    const item = queue[idx];
    if (!item) continue;
    if (usedPending.has(item.id)) {
      skipped += 1;
      continue;
    }
    usedPending.add(item.id);
    newEnclosures.push({
      ...emptyEnclosure(),
      description: pendingItemEnclosureDescription(item),
      included: true,
      copies: "1",
      pending_id: item.id,
      log_row_id: item.log_row_id || undefined,
    });
    added += 1;
  }
  return {
    transmittal: { ...transmittal, enclosures: newEnclosures.length ? newEnclosures : [emptyEnclosure()] },
    added,
    skipped,
  };
}

export function removePendingItems(
  transmittal: TransmittalData,
  indices: number[],
): TransmittalData {
  const removeSet = new Set(indices);
  const queue = (transmittal.pending_submittal_queue ?? []).filter((_, i) => !removeSet.has(i));
  return { ...transmittal, pending_submittal_queue: queue };
}

export function refreshEnclosuresFromTradeData(
  transmittal: TransmittalData,
  tradeData: ProjectTradeData,
): TransmittalData {
  const descriptions: { desc: string; copies: string }[] = [];
  const includePaintFloor = transmittal.include_paint_floor;
  const includeWcFloor = transmittal.include_wc_floor;

  for (const item of tradeData.paint_submittal?.items ?? []) {
    const desc = paintItemToTransmittalDescription(item, includePaintFloor);
    if (desc) descriptions.push({ desc, copies: "1" });
  }
  for (const item of tradeData.wallcovering_submittal?.items ?? []) {
    if (item.include_in_submittal === false) continue;
    const desc = wallcoveringItemToTransmittalDescription(item, includeWcFloor);
    if (desc) descriptions.push({ desc, copies: item.qty.trim() || "1" });
  }

  const enclosures = descriptions.map(({ desc, copies }) => ({
    ...emptyEnclosure(),
    description: desc,
    included: true,
    copies,
  }));

  return {
    ...transmittal,
    enclosures: enclosures.length ? enclosures : [emptyEnclosure()],
  };
}

export type AtticStockOrderResult =
  | { ok: true; paintItems: AtticStockPaintItem[]; customItems: AtticStockCustomItem[] }
  | { ok: false; error: string };

/** Match included transmittal enclosures to paint tab items (desktop transmittal_order_attic_stock). */
export function buildAtticStockFromTransmittal(
  transmittal: TransmittalData,
  tradeData: ProjectTradeData,
): AtticStockOrderResult {
  const includedItems: Record<string, string> = {};
  for (const row of transmittal.enclosures) {
    if (!row.included) continue;
    const desc = row.description.trim();
    if (!desc) continue;
    includedItems[desc] = row.copies.trim() || "1";
  }

  if (!Object.keys(includedItems).length) {
    return {
      ok: false,
      error:
        "No items are selected in the transmittal. Include at least one enclosure, or use Refresh to populate from Paint/Wallcovering.",
    };
  }

  const includePaintFloor = transmittal.include_paint_floor;
  const paintItems: AtticStockPaintItem[] = [];
  const matchedDescriptions = new Set<string>();

  for (const item of tradeData.paint_submittal?.items ?? []) {
    const desc = paintItemToTransmittalDescription(item, includePaintFloor);
    if (!desc) continue;
    if (desc in includedItems) {
      paintItems.push({ ...item, qty: includedItems[desc]! });
      matchedDescriptions.add(desc);
    }
  }

  const customItems: AtticStockCustomItem[] = Object.entries(includedItems)
    .filter(([desc]) => !matchedDescriptions.has(desc))
    .map(([description, qty]) => ({ description, qty }));

  if (!paintItems.length && !customItems.length) {
    return {
      ok: false,
      error:
        "No items in the transmittal match the current Paint tab items. Use Refresh to populate from Paint, or ensure enclosures are included.",
    };
  }

  return { ok: true, paintItems, customItems };
}

export function addItemsFromPaintHistory(
  transmittal: TransmittalData,
  items: PaintItem[],
  replace: boolean,
  includeFloor: boolean,
): TransmittalData {
  const existing = replace ? [] : transmittal.enclosures.filter((e) => e.description.trim());
  const additions = items
    .map((item) => paintItemToTransmittalDescription(item, includeFloor))
    .filter(Boolean)
    .map((desc) => ({ ...emptyEnclosure(), description: desc, included: true, copies: "1" }));
  const enclosures = [...existing, ...additions];
  return {
    ...transmittal,
    enclosures: enclosures.length ? enclosures : [emptyEnclosure()],
  };
}

export function addItemsFromWallcoveringHistory(
  transmittal: TransmittalData,
  items: WallcoveringItem[],
  replace: boolean,
  includeFloor: boolean,
): TransmittalData {
  const existing = replace ? [] : transmittal.enclosures.filter((e) => e.description.trim());
  const additions = items
    .filter((item) => item.include_in_submittal !== false)
    .map((item) => wallcoveringItemToTransmittalDescription(item, includeFloor))
    .filter(Boolean)
    .map((desc) => ({ ...emptyEnclosure(), description: desc, included: true, copies: "1" }));
  const enclosures = [...existing, ...additions];
  return {
    ...transmittal,
    enclosures: enclosures.length ? enclosures : [emptyEnclosure()],
  };
}

export function moveEnclosure(
  enclosures: TransmittalEnclosure[],
  index: number,
  delta: number,
): TransmittalEnclosure[] {
  const next = index + delta;
  if (next < 0 || next >= enclosures.length) return enclosures;
  const copy = [...enclosures];
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row!);
  return copy;
}

export function patchEnclosureList(
  enclosures: TransmittalEnclosure[],
  index: number,
  patch: Partial<TransmittalEnclosure>,
): TransmittalEnclosure[] {
  return enclosures.map((row, i) => (i === index ? normalizeEnclosure({ ...row, ...patch }) : row));
}

export function includedLogRowIds(transmittal: TransmittalData): string[] {
  const ids = new Set<string>();
  for (const enc of transmittal.enclosures) {
    if (!enc.included) continue;
    if (enc.log_row_id?.trim()) ids.add(enc.log_row_id.trim());
    if (enc.pending_id?.trim()) {
      const pending = transmittal.pending_submittal_queue?.find((p) => p.id === enc.pending_id);
      if (pending?.log_row_id?.trim()) ids.add(pending.log_row_id.trim());
    }
  }
  return [...ids];
}

export function paintSheetLabel(nums: number[]): string {
  if (!nums.length) return "(none)";
  return nums.map((n) => `#${n}`).join(", ");
}

export type EmailRelayDetails = {
  tracking?: string;
  est_delivery?: string;
  delivered_to?: string;
  date_delivered?: string;
};

function emailRelayRecipientFirst(transmittal: TransmittalData): string {
  const toName = transmittal.to_name.trim();
  if (toName) return toName.split(/\s+/)[0]!;
  const gc = transmittal.gc_name.trim();
  return gc || "there";
}

function emailRelayGreeting(transmittal: TransmittalData): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Hi";
  return `${timeGreeting} ${emailRelayRecipientFirst(transmittal)},`;
}

function emailRelayActionWord(transmittal: TransmittalData): string {
  return transmittal.delivery_method === "Hand Delivered" ? "hand delivered" : "shipped";
}

function includedEnclosureDescriptions(transmittal: TransmittalData): string[] {
  return transmittal.enclosures
    .filter((e) => e.included && e.description.trim())
    .map((e) => enclosureOutputDescription(e));
}

function emailRelayDeliveryPlain(transmittal: TransmittalData, details: EmailRelayDetails): string {
  if (transmittal.delivery_method === "Hand Delivered") {
    const lines = ["Delivery Method: Hand Delivered"];
    if (details.delivered_to?.trim()) lines.push(`Delivered To: ${details.delivered_to.trim()}`);
    if (details.date_delivered?.trim()) lines.push(`Date Delivered: ${details.date_delivered.trim()}`);
    return lines.join("\n");
  }
  const lines = [`Delivery Method: ${transmittal.delivery_method}`];
  if (details.tracking?.trim()) lines.push(`Tracking Number: ${details.tracking.trim()}`);
  if (details.est_delivery?.trim()) lines.push(`Estimated Delivery: ${details.est_delivery.trim()}`);
  return lines.join("\n");
}

function emailRelayDeliveryHtml(transmittal: TransmittalData, details: EmailRelayDetails): string {
  return emailRelayDeliveryPlain(transmittal, details).replace(/\n/g, "<br>");
}

export function buildEmailRelaySubject(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
): string {
  const submittalNo = transmittal.transmittal_number.trim() || "TR-001";
  return `Submittal No. ${submittalNo} – ${project.job_number} – ${project.job_name}`;
}

/** Plain-text body for mailto: (no HTML support in mailto links). */
export function buildEmailRelayPlainBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
  details: EmailRelayDetails = {},
): string {
  const submittalNo = transmittal.transmittal_number.trim() || "TR-001";
  const enclosures = includedEnclosureDescriptions(transmittal);
  const encBlock = enclosures.length
    ? enclosures.map((line) => `• ${line}`).join("\n")
    : "(See transmittal for full enclosure list)";

  return [
    emailRelayGreeting(transmittal),
    "",
    `Submittal No. ${submittalNo} for ${project.job_name} has been ${emailRelayActionWord(transmittal)}.`,
    "",
    "The transmittal and submittal package are attached for your review.",
    "",
    "This submittal includes:",
    encBlock,
    "",
    emailRelayDeliveryPlain(transmittal, details),
    "",
    "Please let me know if you need anything further.",
    "",
    "Thank you,",
    "",
  ].join("\n");
}

/** HTML body for relay copy — matches desktop Outlook relay formatting. */
export function buildEmailRelayHtmlBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
  details: EmailRelayDetails = {},
): string {
  const submittalNo = transmittal.transmittal_number.trim() || "TR-001";
  const enclosures = includedEnclosureDescriptions(transmittal);
  const encSection = enclosures.length
    ? `<ul>${enclosures.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : "<p><em>(See transmittal for full enclosure list)</em></p>";
  const p =
    'style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 12px 0;"';
  const pTight = 'style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 6px 0;"';
  const pDelivery = 'style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:12px 0 12px 0;"';

  return [
    `<p ${p}>${esc(emailRelayGreeting(transmittal))}</p>`,
    `<p ${p}>Submittal No. ${esc(submittalNo)} for ${esc(project.job_name)} has been <strong>${esc(emailRelayActionWord(transmittal))}</strong>.</p>`,
    `<p ${p}>The transmittal and submittal package are attached for your review.</p>`,
    `<p ${pTight}><strong>This submittal includes:</strong></p>`,
    encSection,
    `<p ${pDelivery}>${emailRelayDeliveryHtml(transmittal, details)}</p>`,
    `<p ${p}>Please let me know if you need anything further.</p>`,
    `<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 0 0;">Thank you,</p>`,
    "<br>",
  ].join("");
}

export function defaultEmailRelayDetails(transmittal: TransmittalData): EmailRelayDetails {
  if (transmittal.delivery_method === "Hand Delivered") {
    return { date_delivered: formatLongDate() };
  }
  return {};
}

export async function openEmailRelayMailto(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
  details: EmailRelayDetails,
  method: ComposeEmailMethod = "gmail",
): Promise<OpenMailtoResult> {
  const subject = buildEmailRelaySubject(project, transmittal);
  const plainBody = buildEmailRelayPlainBody(project, transmittal, details);
  const htmlBody = `<html><body>${buildEmailRelayHtmlBody(project, transmittal, details)}</body></html>`;
  return openGmailComposeWithHtml({
    to: [],
    cc: [],
    subject,
    htmlBody,
    plainFallback: plainBody,
    method,
  });
}

export async function copyEmailRelayHtml(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
  details: EmailRelayDetails,
): Promise<void> {
  const plainBody = buildEmailRelayPlainBody(project, transmittal, details);
  const htmlBody = `<html><body>${buildEmailRelayHtmlBody(project, transmittal, details)}</body></html>`;
  await copyHtmlToClipboard(htmlBody, plainBody);
}

/** @deprecated Use buildEmailRelayPlainBody */
export function buildEmailRelayBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
): string {
  return buildEmailRelayPlainBody(project, transmittal);
}
