import {
  applyInferredContentFlags,
  defaultTransmittalContentAutoOn,
  inferContentKeysFromPending,
  type TransmittalContentKey,
} from "./transmittalCategories";
import { formatLineNumberDisplay, sdsSubmittalDescription } from "./submittalLogHelpers";
import { sdsPacketSpecSectionsLabel } from "./sdsSectionModel";
import type { SubmittalLogRow } from "../types/submittalLog";
import {
  emptyEnclosure,
  normalizeEnclosure,
  normalizePendingItem,
  type PendingSubmittalItem,
  type SdsPacketData,
  type TransmittalData,
  type TransmittalEnclosure,
} from "../types/tradeDocuments";
import { esc, formatLongDate } from "./printCore";
import type { EmailSignatureSettings } from "./emailSignature";
import { buildEmailSignatureHtml, buildEmailSignaturePlain } from "./emailSignature";
import {
  openGmailComposeWithHtml,
  copyHtmlToClipboard,
  type OpenMailtoResult,
} from "./paintVendorEmail";
import type { ComposeEmailMethod } from "./paintUserSettings";

export function enclosureOutputDescription(row: TransmittalEnclosure): string {
  const base = stripPdfFilenameFromEnclosureDescription(row.description);
  if (!row.digital_copy) return base;
  return base ? `${base} (Digital Copy)` : "(Digital Copy)";
}

/** Drop trailing "(Something.pdf)" so GC-facing enclosure lines stay clean. */
export function stripPdfFilenameFromEnclosureDescription(description: string): string {
  return description
    .trim()
    .replace(/\s*\(([^()]+\.pdf)\)\s*$/i, "")
    .trim();
}

export function pendingItemEnclosureDescription(item: PendingSubmittalItem): string {
  const normalized = normalizePendingItem(item);
  const source = normalized.source.trim();
  if (source === "sds_packet") {
    const spec = normalized.spec_section.trim();
    const packet = normalized.packet_type.trim();
    // Do not append linked_files / download filenames — those stay internal.
    if (spec && packet) return `${spec} · ${packet}`;
    return spec || packet || "Product Data";
  }
  if (source === "paint_submittal") {
    const stype = normalized.submittal_type.trim();
    const base = stype ? `${stype} · Paint` : "Color Samples · Paint";
    const spec = normalized.spec_section.trim();
    return spec ? `${spec} · ${base}` : base;
  }
  if (source === "wallcovering_submittal") {
    const stype = normalized.submittal_type.trim();
    const base = stype ? `${stype} · Wallcovering` : "Color Samples · Wallcovering";
    const spec = normalized.spec_section.trim();
    return spec ? `${spec} · ${base}` : base;
  }
  if (source === "frp_submittal") {
    const stype = normalized.submittal_type.trim();
    const base = stype ? `${stype} · FRP` : "Product Data · FRP";
    const spec = normalized.spec_section.trim();
    return spec ? `${spec} · ${base}` : base;
  }
  const scope = normalized.scope.trim();
  const stype = normalized.submittal_type.trim();
  if (scope && stype) return `${stype} · ${scope}`;
  return stype || scope || "Submittal package";
}

export function pendingItemLabel(item: PendingSubmittalItem): string {
  const desc = pendingItemEnclosureDescription(item);
  const num = item.trade_submittal_number.trim();
  if (!num) return desc;
  const n = Number.parseInt(num, 10);
  const label = Number.isFinite(n) && n > 0 ? `#${String(n).padStart(3, "0")}` : `#${num}`;
  return `${label} · ${desc}`;
}

/**
 * Queues a submittal package for transmittal enclosure. Re-downloading the same
 * package (same source + trade submittal number) must not duplicate its queue
 * entry — refresh the existing one in place instead, keeping its id so any
 * enclosure already linked to it (via pending_id) stays linked.
 */
export function queuePendingItem(
  transmittal: TransmittalData,
  item: Partial<PendingSubmittalItem>,
  autoAllowed: readonly TransmittalContentKey[] = defaultTransmittalContentAutoOn(),
): TransmittalData {
  const normalized = normalizePendingItem(item);
  const existingQueue = transmittal.pending_submittal_queue ?? [];
  const dupeIndex =
    normalized.source && normalized.trade_submittal_number
      ? existingQueue.findIndex(
          (q) => q.source === normalized.source && q.trade_submittal_number === normalized.trade_submittal_number,
        )
      : -1;
  const queue =
    dupeIndex >= 0
      ? existingQueue.map((q, i) => (i === dupeIndex ? { ...normalized, id: q.id } : q))
      : [...existingQueue, normalized];
  const withFlags = applyInferredContentFlags(
    transmittal,
    inferContentKeysFromPending(normalized),
    autoAllowed,
  );
  return {
    ...withFlags,
    pending_submittal_queue: queue,
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
      description: stripPdfFilenameFromEnclosureDescription(pendingItemEnclosureDescription(item)),
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

function logSourceForScope(scope: string): string {
  const s = scope.trim().toLowerCase();
  if (s === "paint") return "paint_submittal";
  if (s.includes("wallcover")) return "wallcovering_submittal";
  if (s === "frp") return "frp_submittal";
  if (s === "product data") return "sds_packet";
  return "";
}

export function logRowAsPending(row: SubmittalLogRow): PendingSubmittalItem {
  const source = logSourceForScope(row.scope);
  return normalizePendingItem({
    submittal_type: row.submittal_type,
    scope: row.scope,
    spec: row.spec,
    section: row.section,
    spec_section: row.section || row.spec,
    packet_type: source === "sds_packet" ? row.submittal_type : "",
    notes: row.notes,
    source,
    log_row_id: row.id,
    trade_submittal_number: row.trade_submittal_number,
  });
}

export function logRowEnclosureDescription(row: SubmittalLogRow): string {
  const scope = row.scope.trim();
  const stype = row.submittal_type.trim();
  const spec = row.section.trim();
  if (scope === "Product Data") return row.notes.trim() || stype || "Product Data";
  if (scope === "Paint" || scope === "Wallcovering" || scope === "FRP") {
    const base = stype ? `${stype} · ${scope}` : scope;
    return spec ? `${spec} · ${base}` : base;
  }
  if (row.notes.trim()) return row.notes.trim();
  return [stype, scope, spec].filter(Boolean).join(" · ") || "Submittal item";
}

/** Package number for a product-data log row that was saved before the number was stored. */
export function productPackageNumberForLogRow(
  row: SubmittalLogRow,
  packets: readonly SdsPacketData[],
): string {
  if (row.scope.trim() !== "Product Data") return "";
  const note = row.notes.trim();
  const type = row.submittal_type.trim();
  const section = row.section.trim();
  const unique = new Map<number, SdsPacketData>();
  for (const packet of packets) {
    if (!packet?.submittal_number) continue;
    unique.set(packet.submittal_number, packet);
  }
  const list = [...unique.values()];
  const described = list.filter((packet) => {
    const label = sdsPacketSpecSectionsLabel(packet.sections);
    if (note && sdsSubmittalDescription(label, packet.packet_type) === note) return true;
    if (!type || packet.packet_type !== type || !label || !section) return false;
    return section === label || section.includes(label) || label.includes(section);
  });
  if (described.length === 1) return String(described[0]!.submittal_number);
  const sameType = list.filter((packet) => !type || packet.packet_type === type);
  if (sameType.length === 1) return String(sameType[0]!.submittal_number);
  return "";
}

export function logRowSuggestionLabel(row: SubmittalLogRow, packageNumber = ""): string {
  const line = formatLineNumberDisplay(row.line_number);
  const logTag = line ? `Log #${line}` : "";
  const num = row.trade_submittal_number.trim() || packageNumber.trim();
  const n = Number.parseInt(num, 10);
  const tag = Number.isFinite(n) && n > 0 ? `#${String(n).padStart(3, "0")}` : "";
  return [logTag, tag, logRowEnclosureDescription(row)].filter(Boolean).join(" · ");
}

/** Ready log rows that are not already an enclosure or still sitting in the old pending queue. */
export function readyLogRowsForTransmittal(
  rows: readonly SubmittalLogRow[],
  transmittal: TransmittalData,
): SubmittalLogRow[] {
  const used = new Set<string>();
  for (const enc of transmittal.enclosures) {
    if (enc.log_row_id?.trim()) used.add(enc.log_row_id.trim());
  }
  for (const item of transmittal.pending_submittal_queue ?? []) {
    if (item.log_row_id?.trim()) used.add(item.log_row_id.trim());
  }
  return rows.filter((row) => row.id && !used.has(row.id) && row.status.trim().toLowerCase() === "ready");
}

export function appendLogRowsToEnclosures(
  transmittal: TransmittalData,
  rows: readonly SubmittalLogRow[],
): { transmittal: TransmittalData; added: number; skipped: number } {
  const used = new Set(transmittal.enclosures.map((e) => e.log_row_id).filter(Boolean) as string[]);
  let added = 0;
  let skipped = 0;
  const newEnclosures = [...transmittal.enclosures.filter((e) => e.description.trim())];
  const addedItems: PendingSubmittalItem[] = [];
  for (const row of rows) {
    if (!row.id) continue;
    if (used.has(row.id)) {
      skipped += 1;
      continue;
    }
    used.add(row.id);
    newEnclosures.push({
      ...emptyEnclosure(),
      description: stripPdfFilenameFromEnclosureDescription(logRowEnclosureDescription(row)),
      included: true,
      copies: "1",
      log_row_id: row.id,
    });
    addedItems.push(logRowAsPending(row));
    added += 1;
  }
  const next = applyPendingSheetIncludes(
    { ...transmittal, enclosures: newEnclosures.length ? newEnclosures : [emptyEnclosure()] },
    addedItems,
  );
  return { transmittal: next, added, skipped };
}

function parseTradeSubmittalNum(raw: string): number | undefined {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function mergeUniqueSubmittalNums(existing: number[], next: number): number[] {
  if (existing.includes(next)) return existing;
  return [...existing, next].sort((a, b) => a - b);
}

/**
 * When pending paint / WC / FRP packages are added, also check Include … sheet
 * and select that submittal # under Build so Generate can attach the detail PDF.
 */
export function applyPendingSheetIncludes(
  transmittal: TransmittalData,
  pendingItems: readonly PendingSubmittalItem[],
): TransmittalData {
  let next = transmittal;
  let linkedSheet = false;

  for (const item of pendingItems) {
    const num = parseTradeSubmittalNum(item.trade_submittal_number);
    if (!num) continue;
    const source = item.source.trim();
    if (source === "paint_submittal") {
      linkedSheet = true;
      next = {
        ...next,
        include_paint_sheet: true,
        paint_submittal_nums: mergeUniqueSubmittalNums(next.paint_submittal_nums, num),
      };
    } else if (source === "wallcovering_submittal") {
      linkedSheet = true;
      next = {
        ...next,
        include_wc_sheet: true,
        wc_submittal_nums: mergeUniqueSubmittalNums(next.wc_submittal_nums, num),
      };
    } else if (source === "frp_submittal") {
      linkedSheet = true;
      next = {
        ...next,
        include_frp_sheet: true,
        frp_submittal_nums: mergeUniqueSubmittalNums(next.frp_submittal_nums, num),
      };
    }
  }

  if (linkedSheet && !next.combine_enclosures) {
    next = { ...next, combine_enclosures: true };
  }
  return next;
}

export function removePendingItems(
  transmittal: TransmittalData,
  indices: number[],
): TransmittalData {
  const removeSet = new Set(indices);
  const queue = (transmittal.pending_submittal_queue ?? []).filter((_, i) => !removeSet.has(i));
  return { ...transmittal, pending_submittal_queue: queue };
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
  signature?: EmailSignatureSettings,
): string {
  const submittalNo = transmittal.transmittal_number.trim() || "TR-001";
  const enclosures = includedEnclosureDescriptions(transmittal);
  const encBlock = enclosures.length
    ? enclosures.map((line) => `• ${line}`).join("\n")
    : "(See transmittal for full enclosure list)";

  const parts = [
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
  ];
  if (signature) parts.push(buildEmailSignaturePlain(signature));
  return parts.join("\n");
}

/** HTML body for relay copy — matches desktop Outlook relay formatting. */
export function buildEmailRelayHtmlBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
  details: EmailRelayDetails = {},
  signature?: EmailSignatureSettings,
  logoUrl = "",
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

  const html = [
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
  const sig = signature ? buildEmailSignatureHtml(signature, logoUrl) : "";
  return html + sig;
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
  signature?: EmailSignatureSettings,
  logoUrl = "",
): Promise<OpenMailtoResult> {
  const subject = buildEmailRelaySubject(project, transmittal);
  const plainBody = buildEmailRelayPlainBody(project, transmittal, details, signature);
  const htmlBody = `<html><body>${buildEmailRelayHtmlBody(project, transmittal, details, signature, logoUrl)}</body></html>`;
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
  signature?: EmailSignatureSettings,
  logoUrl = "",
): Promise<void> {
  const plainBody = buildEmailRelayPlainBody(project, transmittal, details, signature);
  const htmlBody = `<html><body>${buildEmailRelayHtmlBody(project, transmittal, details, signature, logoUrl)}</body></html>`;
  await copyHtmlToClipboard(htmlBody, plainBody);
}

/** @deprecated Use buildEmailRelayPlainBody */
export function buildEmailRelayBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
): string {
  return buildEmailRelayPlainBody(project, transmittal);
}
