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
  if (source === "paint_submittal") return "Color Samples · Paint";
  if (source === "wallcovering_submittal") return "Color Samples · Wallcovering";
  if (source === "frp_submittal") return "Product Data · FRP";
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

export function buildEmailRelayBody(
  project: { job_number: string; job_name: string },
  transmittal: TransmittalData,
): string {
  const enclosures = transmittal.enclosures
    .filter((e) => e.included && e.description.trim())
    .map((e) => `• ${enclosureOutputDescription(e)}`)
    .join("\n");
  return [
    `Job: ${project.job_number} — ${project.job_name}`,
    `Transmittal #: ${transmittal.transmittal_number}`,
    `Delivery: ${transmittal.delivery_method}`,
    "",
    "Enclosures:",
    enclosures || "(none selected)",
    "",
    transmittal.remarks.trim() ? `Remarks:\n${transmittal.remarks.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
