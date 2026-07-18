/** Transmittal cover "we are transmitting" categories + org auto-on map. */

import { patchOrgSettings, removeUserSettingsKeys } from "./budgetLibrary";
import { loadOrgSettingsBlob } from "./orgSettings";
import type { PendingSubmittalItem, TransmittalData } from "../types/tradeDocuments";
import { normalizePendingItem } from "../types/tradeDocuments";

export const TRANSMITTAL_CONTENT_AUTO_ON_KEY = "transmittal_content_auto_on";

export const TRANSMITTAL_CONTENT_CATEGORIES = [
  { key: "cb_submittal", label: "Submittal" },
  { key: "cb_product_data", label: "Product Data" },
  { key: "cb_samples", label: "Samples" },
  { key: "cb_sds_safety", label: "SDS/Safety" },
  { key: "cb_shop_drawings", label: "Shop Drawings" },
  { key: "cb_om_manuals", label: "O&M Manuals" },
  { key: "cb_plans", label: "Plans" },
  { key: "cb_letters", label: "Letters" },
  { key: "cb_specifications", label: "Specifications" },
  { key: "cb_prints", label: "Prints" },
  { key: "cb_addenda", label: "Addenda" },
  { key: "cb_change_orders", label: "Change Orders" },
  { key: "cb_arch_drawings", label: "Architectural Drawings" },
  { key: "cb_eng_drawings", label: "Engineering Drawings" },
  { key: "cb_invoices", label: "Invoices" },
] as const;

export type TransmittalContentKey = (typeof TRANSMITTAL_CONTENT_CATEGORIES)[number]["key"];

/** Categories that may auto-enable from enclosures / pending (org setting default). */
export const DEFAULT_TRANSMITTAL_CONTENT_AUTO_ON: TransmittalContentKey[] = [
  "cb_submittal",
  "cb_product_data",
  "cb_samples",
  "cb_sds_safety",
];

/** Always shown in the pill row; the rest sit behind "+ more". */
export const PRIMARY_TRANSMITTAL_CONTENT_KEYS: TransmittalContentKey[] = [
  "cb_submittal",
  "cb_product_data",
  "cb_samples",
  "cb_sds_safety",
  "cb_shop_drawings",
  "cb_om_manuals",
];

const ALL_KEYS = new Set<string>(TRANSMITTAL_CONTENT_CATEGORIES.map((c) => c.key));

let cachedAutoOn: TransmittalContentKey[] | null = null;

export function isTransmittalContentKey(value: string): value is TransmittalContentKey {
  return ALL_KEYS.has(value);
}

export function normalizeTransmittalContentAutoOn(raw: unknown): TransmittalContentKey[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<TransmittalContentKey>();
  const out: TransmittalContentKey[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isTransmittalContentKey(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function defaultTransmittalContentAutoOn(): TransmittalContentKey[] {
  return [...DEFAULT_TRANSMITTAL_CONTENT_AUTO_ON];
}

export function clearTransmittalContentAutoOnCache(): void {
  cachedAutoOn = null;
}

export async function loadTransmittalContentAutoOn(_userId?: string | null): Promise<TransmittalContentKey[]> {
  if (cachedAutoOn) return cachedAutoOn;
  const org = await loadOrgSettingsBlob();
  const fromOrg = normalizeTransmittalContentAutoOn(org[TRANSMITTAL_CONTENT_AUTO_ON_KEY]);
  if (fromOrg) {
    cachedAutoOn = fromOrg;
    return fromOrg;
  }
  const defaults = defaultTransmittalContentAutoOn();
  cachedAutoOn = defaults;
  return defaults;
}

export async function loadTransmittalContentAutoOnDraft(_userId: string): Promise<{
  keys: TransmittalContentKey[];
  usingCustom: boolean;
}> {
  const org = await loadOrgSettingsBlob();
  const custom = normalizeTransmittalContentAutoOn(org[TRANSMITTAL_CONTENT_AUTO_ON_KEY]);
  if (custom) return { keys: custom, usingCustom: true };
  return { keys: defaultTransmittalContentAutoOn(), usingCustom: false };
}

export async function saveTransmittalContentAutoOn(
  userId: string,
  keys: TransmittalContentKey[],
): Promise<string | null> {
  const next = normalizeTransmittalContentAutoOn(keys) ?? [];
  const err = await patchOrgSettings(userId, { [TRANSMITTAL_CONTENT_AUTO_ON_KEY]: next });
  if (!err) cachedAutoOn = next;
  return err;
}

export async function resetTransmittalContentAutoOn(userId: string): Promise<string | null> {
  const err = await removeUserSettingsKeys(userId, [TRANSMITTAL_CONTENT_AUTO_ON_KEY]);
  if (!err) clearTransmittalContentAutoOnCache();
  return err;
}

export function contentCategoryLabel(key: TransmittalContentKey): string {
  return TRANSMITTAL_CONTENT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** Infer cover checkboxes from a pending queue item. */
export function inferContentKeysFromPending(item: Partial<PendingSubmittalItem>): TransmittalContentKey[] {
  const normalized = normalizePendingItem(item);
  const keys = new Set<TransmittalContentKey>(["cb_submittal"]);
  const stype = normalized.submittal_type.toLowerCase();
  const packet = normalized.packet_type.toLowerCase();

  if (stype === "product data" || normalized.source === "sds_packet") {
    keys.add("cb_product_data");
  }
  if (stype.includes("color") || stype.includes("sample")) {
    keys.add("cb_samples");
  }
  if (
    normalized.source === "sds_packet" ||
    packet.includes("sds") ||
    stype.includes("sds")
  ) {
    keys.add("cb_sds_safety");
  }
  if (stype.includes("shop") || packet.includes("shop")) {
    keys.add("cb_shop_drawings");
  }
  if (stype.includes("o&m") || stype.includes("om ") || packet.includes("o&m") || packet.includes("om_")) {
    keys.add("cb_om_manuals");
  }
  return [...keys];
}

/** Infer from enclosure / log-style description text. */
export function inferContentKeysFromText(text: string): TransmittalContentKey[] {
  const t = text.toLowerCase();
  const keys = new Set<TransmittalContentKey>(["cb_submittal"]);
  if (t.includes("product data") || t.includes("tds")) keys.add("cb_product_data");
  if (t.includes("sample") || t.includes("brush") || t.includes("color")) keys.add("cb_samples");
  if (t.includes("sds") || t.includes("safety")) keys.add("cb_sds_safety");
  if (t.includes("shop drawing")) keys.add("cb_shop_drawings");
  if (t.includes("o&m") || t.includes("maintenance")) keys.add("cb_om_manuals");
  if (t.includes("plan")) keys.add("cb_plans");
  return [...keys];
}

export function inferContentKeysFromTransmittal(data: TransmittalData): Set<TransmittalContentKey> {
  const keys = new Set<TransmittalContentKey>();
  for (const item of data.pending_submittal_queue ?? []) {
    for (const key of inferContentKeysFromPending(item)) keys.add(key);
  }
  for (const row of data.enclosures) {
    if (!row.included || !row.description.trim()) continue;
    for (const key of inferContentKeysFromText(row.description)) keys.add(key);
  }
  return keys;
}

/** OR-in inferred flags that are allowed by the org auto-on map. Does not turn anything off. */
export function applyInferredContentFlags(
  transmittal: TransmittalData,
  inferred: readonly TransmittalContentKey[],
  autoAllowed: readonly TransmittalContentKey[],
): TransmittalData {
  const allowed = new Set(autoAllowed);
  let next = transmittal;
  for (const key of inferred) {
    if (!allowed.has(key)) continue;
    if (next[key]) continue;
    next = { ...next, [key]: true };
  }
  return next;
}
