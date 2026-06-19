import type { Json } from "./database";
import type { BudgetMakerData } from "./budgetMaker";
import { normalizeTransmittalNumber as normalizeTransmittalNumberField } from "../lib/transmittalNumber";
import { DEFAULT_TRANSMITTAL_REMARK } from "../lib/transmittalRemarks";
import { normalizeSdsSection as normalizeSdsSectionRow } from "../lib/sdsSectionModel";

export type PaintItem = {
  label: string;
  floor: string;
  manufacturer: string;
  color: string;
  product: string;
  sheen: string;
  previous_color: string;
};

export type WallcoveringItem = {
  label: string;
  floor: string;
  manufacturer: string;
  product: string;
  color: string;
  previous_color: string;
  qty: string;
  notes: string;
  panels: boolean;
  include_in_submittal: boolean;
  /** Include in Orders by Vendor / Order Samples */
  order: boolean;
};

export type TradeSubmittalType = "new" | "revised" | "substitution" | "original";

export type PaintSubmittalData = {
  submittal_number: number;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: PaintItem[];
  submittal_ordered?: boolean;
  paint_vendor?: string;
  brushout_prep?: BrushoutPrepLink;
};

export type BrushoutPrepLink = {
  prep_id: string;
  site_location?: string;
  gc?: string;
  internal_reference?: string;
  emailed_date?: string;
};

export type SubmittalHistoryEntry = {
  submittal_number: number;
  date: string;
  items: PaintItem[] | WallcoveringItem[];
  submittal_type?: TradeSubmittalType;
  scope?: "paint" | "wallcovering";
};

export type WallcoveringSubmittalData = {
  submittal_number: number;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: WallcoveringItem[];
  got_track?: boolean;
};

export type TransmittalEnclosure = {
  id: string;
  description: string;
  included: boolean;
  copies: string;
  for_field: string;
  digital_copy: boolean;
  log_row_id?: string;
  pending_id?: string;
};

export type PendingSubmittalItem = {
  id: string;
  submittal_type: string;
  scope: string;
  spec: string;
  section: string;
  spec_section: string;
  packet_type: string;
  linked_files: string[];
  notes: string;
  source: string;
  log_row_id: string;
  trade_submittal_number: string;
};

export type TransmittalData = {
  /** Formatted transmittal id, e.g. TR-001 */
  transmittal_number: string;
  date: string;
  subject: string;
  to_name: string;
  gc_name: string;
  to_address: string;
  to_phone: string;
  from_block: string;
  from_phone: string;
  delivery_method: string;
  delivery_other_text: string;
  cb_enclosed: boolean;
  cb_under_sep_cover: boolean;
  cb_via: boolean;
  cb_submittal: boolean;
  cb_product_data: boolean;
  cb_samples: boolean;
  cb_shop_drawings: boolean;
  cb_om_manuals: boolean;
  cb_plans: boolean;
  cb_letters: boolean;
  cb_specifications: boolean;
  cb_prints: boolean;
  cb_addenda: boolean;
  cb_change_orders: boolean;
  cb_sds_safety: boolean;
  cb_arch_drawings: boolean;
  cb_invoices: boolean;
  cb_eng_drawings: boolean;
  show_for_column: boolean;
  include_paint_floor: boolean;
  include_wc_floor: boolean;
  combine_enclosures: boolean;
  use_excel_template: boolean;
  include_paint_sheet: boolean;
  include_wc_sheet: boolean;
  paint_submittal_nums: number[];
  wc_submittal_nums: number[];
  remarks: string;
  copies_to: string;
  signer_name: string;
  enclosures: TransmittalEnclosure[];
  pending_submittal_queue: PendingSubmittalItem[];
};

export type ProjectTradeData = {
  paint_submittal?: PaintSubmittalData;
  paint_submittal_history?: SubmittalHistoryEntry[];
  wallcovering_submittal?: WallcoveringSubmittalData;
  wallcovering_submittal_history?: SubmittalHistoryEntry[];
  transmittal?: TransmittalData;
  sds_packet?: SdsPacketData;
  budget_maker?: BudgetMakerData;
};

import {
  defaultCoverPurpose,
  isPresetCoverPurpose,
  normalizePacketType,
  sdsPacketFilename,
  type SdsPacketType,
} from "../lib/sdsPacketPresets";

export type { SdsPacketType } from "../lib/sdsPacketPresets";
export {
  SDS_PACKET_TYPES,
  coverMainTitle,
  defaultCoverPurpose,
  isPresetCoverPurpose,
  resolveCoverPurpose,
  sdsPacketFilename,
} from "../lib/sdsPacketPresets";

import type { SdsSectionAttachments, SdsSectionCategory } from "../lib/sdsSectionModel";

export type { SdsSectionCategory } from "../lib/sdsSectionModel";

export type SdsSection = {
  id: string;
  category: SdsSectionCategory;
  manufacturer: string;
  product: string;
  finish_type: string;
  system_material: string;
  color: string;
  intended_use: string;
  attachments: SdsSectionAttachments;
};

export type SdsPacketData = {
  packet_type: SdsPacketType;
  spec_section: string;
  preparer: string;
  date: string;
  submittal_number: number;
  /** Used when packet_type is Custom */
  cover_title: string;
  cover_subtitle: string;
  cover_purpose: string;
  include_cover: boolean;
  include_toc: boolean;
  include_dividers: boolean;
  include_stamp: boolean;
  include_end: boolean;
  add_to_submittal_log: boolean;
  add_to_transmittal: boolean;
  sections: SdsSection[];
};

export const DEFAULT_SPEC_SECTIONS = [
  "09 51 00 - Acoustical Ceilings",
  "09 62 00 - Specialty Ceilings",
  "09 65 00 - Resilient Flooring",
  "09 67 00 - Fluid-Applied Flooring",
  "09 72 00 - Wall Coverings",
  "09 84 00 - Acoustical Treatment",
  "09 91 13 - Exterior Painting",
  "09 91 23 - Interior Painting",
  "09 96 00 - High-Performance Coatings",
  "09 97 00 - Special Coatings",
  "07 84 00 - Firestopping",
  "07 92 00 - Joint Sealants",
  "06 60 00 - Plastic Fabrications (FRP)",
  "06 20 00 - Finish Carpentry",
  "09 29 00 - Gypsum Board",
] as const;

export function newSdsSectionId(): string {
  return crypto.randomUUID();
}

export function emptySdsSection(): SdsSection {
  return normalizeSdsSectionRow({});
}

export function defaultSdsPacket(): SdsPacketData {
  const packet_type: SdsPacketType = "SDS & TDS";
  return {
    packet_type,
    spec_section: "",
    preparer: "",
    date: formatTodayLong(),
    submittal_number: 1,
    cover_title: "",
    cover_subtitle: "",
    cover_purpose: defaultCoverPurpose(packet_type),
    include_cover: true,
    include_toc: true,
    include_dividers: true,
    include_stamp: true,
    include_end: true,
    add_to_submittal_log: true,
    add_to_transmittal: true,
    sections: [],
  };
}

export function normalizeSdsPacket(raw: Partial<SdsPacketData> | undefined): SdsPacketData {
  const base = defaultSdsPacket();
  if (!raw) return base;
  const packet_type = normalizePacketType(raw.packet_type ?? base.packet_type);
  return {
    ...base,
    ...raw,
    packet_type,
    cover_title: raw.cover_title?.trim() ?? base.cover_title,
    cover_purpose: isPresetCoverPurpose(packet_type, raw.cover_purpose ?? "")
      ? defaultCoverPurpose(packet_type)
      : raw.cover_purpose?.trim() || defaultCoverPurpose(packet_type),
    cover_subtitle: "",
    spec_section: typeof raw.spec_section === "string" ? raw.spec_section.trim() : "",
    include_cover: raw.include_cover ?? base.include_cover,
    include_toc: raw.include_toc ?? base.include_toc,
    include_dividers: raw.include_dividers ?? base.include_dividers,
    include_stamp: raw.include_stamp ?? base.include_stamp,
    include_end: raw.include_end ?? base.include_end,
    add_to_submittal_log: raw.add_to_submittal_log ?? base.add_to_submittal_log,
    add_to_transmittal: raw.add_to_transmittal ?? base.add_to_transmittal,
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((s) => normalizeSdsSectionRow(s as Parameters<typeof normalizeSdsSectionRow>[0]))
      : base.sections,
  };
}

export function sdsSectionsFromPaintItems(items: PaintItem[]): SdsSection[] {
  const seen = new Set<string>();
  const out: SdsSection[] = [];
  for (const item of items) {
    if (!item.product.trim() && !item.manufacturer.trim()) continue;
    const key = [item.manufacturer, item.product, item.sheen].map((s) => s.trim().toLowerCase()).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const notes: string[] = [];
    if (item.label.trim()) notes.push(`Label ${item.label.trim()}`);
    if (item.color.trim()) notes.push(item.color.trim());
    out.push({
      ...emptySdsSection(),
      category: "Paint",
      manufacturer: item.manufacturer.trim(),
      product: item.product.trim(),
      finish_type: item.sheen.trim(),
      color: item.color.trim(),
      system_material: "Interior Paint",
      intended_use: notes.join("; ") || "",
    });
  }
  return out;
}

export function sdsSectionsFromWallcoveringItems(items: WallcoveringItem[]): SdsSection[] {
  const seen = new Set<string>();
  const out: SdsSection[] = [];
  for (const item of items) {
    if (!item.product.trim() && !item.manufacturer.trim()) continue;
    const key = [item.manufacturer, item.product, item.color]
      .map((s) => s.trim().toLowerCase())
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const notes: string[] = [];
    if (item.label.trim()) notes.push(`Label ${item.label.trim()}`);
    if (item.qty.trim()) notes.push(`Qty ${item.qty.trim()}`);
    if (item.notes.trim()) notes.push(item.notes.trim());
    out.push({
      ...emptySdsSection(),
      category: "Wallcovering",
      manufacturer: item.manufacturer.trim(),
      product: item.product.trim(),
      color: item.color.trim(),
      system_material: item.panels ? "Wallcovering Panels" : "Vinyl Wallcovering",
      intended_use: notes.join("; ") || "",
    });
  }
  return out;
}

export function sdsPacketOutputName(
  jobName: string,
  jobNumber: string,
  packet: Pick<SdsPacketData, "packet_type" | "cover_title" | "spec_section" | "submittal_number">,
): string {
  return sdsPacketFilename(jobName, jobNumber, packet);
}

export const PAINT_SUBMITTAL_TYPES: { id: TradeSubmittalType; label: string }[] = [
  { id: "new", label: "New brush outs" },
  { id: "revised", label: "Revised" },
  { id: "substitution", label: "Color substitution" },
  { id: "original", label: "Original" },
];

export const REVISED_SUBMITTAL_TYPES: { id: TradeSubmittalType; label: string; hint: string }[] = [
  {
    id: "revised",
    label: "Revised Colors",
    hint: "Adjustments to existing colors — control samples will be dropped off",
  },
  {
    id: "new",
    label: "New Colors",
    hint: "Additional colors added to original submittal",
  },
  {
    id: "substitution",
    label: "Color Substitution",
    hint: "Replace an approved color on the same label / square",
  },
];

export const WALLCOVERING_SUBMITTAL_TYPES: { id: TradeSubmittalType; label: string }[] = [
  { id: "new", label: "New wallcovering" },
  { id: "revised", label: "Revised" },
  { id: "substitution", label: "Material substitution" },
  { id: "original", label: "Original" },
];

export const DELIVERY_METHODS = ["FedEx", "UPS", "Courier", "Hand Delivered", "Other"] as const;

const PAINT_SUBJECTS: Record<TradeSubmittalType, string> = {
  new: "Brush Outs",
  revised: "Revised Brush Outs",
  substitution: "Color Substitution - Brush Outs",
  original: "Brush Outs",
};

const WC_SUBJECTS: Record<TradeSubmittalType, string> = {
  new: "New Wallcovering Submittals",
  revised: "Revised Wallcovering Submittals",
  substitution: "Wallcovering Material Substitution",
  original: "Wallcovering Submittals",
};

export function paintSubjectForType(t: TradeSubmittalType): string {
  return PAINT_SUBJECTS[t];
}

export function wcSubjectForType(t: TradeSubmittalType): string {
  return WC_SUBJECTS[t];
}

export function emptyPaintItem(): PaintItem {
  return { label: "", floor: "", manufacturer: "", color: "", product: "", sheen: "", previous_color: "" };
}

export function emptyWallcoveringItem(): WallcoveringItem {
  return {
    label: "",
    floor: "",
    manufacturer: "",
    product: "",
    color: "",
    previous_color: "",
    qty: "",
    notes: "",
    panels: false,
    include_in_submittal: true,
    order: false,
  };
}

export function emptyEnclosure(): TransmittalEnclosure {
  return {
    id: crypto.randomUUID(),
    description: "",
    included: true,
    copies: "1",
    for_field: "",
    digital_copy: false,
  };
}

export function normalizeEnclosure(raw: Partial<TransmittalEnclosure> | null | undefined): TransmittalEnclosure {
  const base = emptyEnclosure();
  if (!raw) return base;
  return {
    id: raw.id?.trim() || base.id,
    description: raw.description?.trim() ?? "",
    included: raw.included ?? true,
    copies: raw.copies?.trim() || "1",
    for_field: raw.for_field?.trim() ?? "",
    digital_copy: raw.digital_copy ?? false,
    log_row_id: raw.log_row_id?.trim() || undefined,
    pending_id: raw.pending_id?.trim() || undefined,
  };
}

export function normalizePendingItem(raw: Partial<PendingSubmittalItem> | null | undefined): PendingSubmittalItem {
  const rawObj = raw ?? {};
  return {
    id: rawObj.id?.trim() || crypto.randomUUID(),
    submittal_type: rawObj.submittal_type?.trim() || "Product Data",
    scope: rawObj.scope?.trim() || "Paint",
    spec: rawObj.spec?.trim() ?? "",
    section: rawObj.section?.trim() ?? "",
    spec_section: rawObj.spec_section?.trim() || rawObj.section?.trim() || "",
    packet_type: rawObj.packet_type?.trim() ?? "",
    linked_files: [...(rawObj.linked_files ?? [])].filter(Boolean),
    notes: rawObj.notes?.trim() ?? "",
    source: rawObj.source?.trim() ?? "",
    log_row_id: rawObj.log_row_id?.trim() ?? "",
    trade_submittal_number: rawObj.trade_submittal_number?.trim() ?? "",
  };
}

export function normalizeTransmittal(raw: Partial<TransmittalData> | null | undefined): TransmittalData {
  const base = defaultTransmittal();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    transmittal_number: normalizeTransmittalNumberField(raw.transmittal_number),
    subject: raw.subject?.trim() ?? base.subject,
    enclosures: (raw.enclosures?.length ? raw.enclosures : base.enclosures).map(normalizeEnclosure),
    pending_submittal_queue: (raw.pending_submittal_queue ?? []).map(normalizePendingItem),
    paint_submittal_nums: [...(raw.paint_submittal_nums ?? [])],
    wc_submittal_nums: [...(raw.wc_submittal_nums ?? [])],
  };
}

export function defaultPaintSubmittal(): PaintSubmittalData {
  return {
    submittal_number: 1,
    submittal_type: "new",
    subject: paintSubjectForType("new"),
    date: formatToday(),
    items: [emptyPaintItem()],
    submittal_ordered: false,
    paint_vendor: "PPG",
  };
}

export const PAINT_VENDOR_OPTIONS = [
  "PPG",
  "Sherwin Williams",
  "Benjamin Moore",
  "Dunn Edwards",
  "Vista",
] as const;

export function defaultWallcoveringSubmittal(): WallcoveringSubmittalData {
  return {
    submittal_number: 1,
    submittal_type: "new",
    subject: wcSubjectForType("new"),
    date: formatToday(),
    items: [emptyWallcoveringItem()],
  };
}

export function defaultTransmittal(): TransmittalData {
  return {
    transmittal_number: "TR-001",
    date: formatTodayLong(),
    subject: "Submittals",
    to_name: "",
    gc_name: "",
    to_address: "",
    to_phone: "",
    from_block: "",
    from_phone: "",
    delivery_method: "FedEx",
    delivery_other_text: "",
    cb_enclosed: true,
    cb_under_sep_cover: false,
    cb_via: false,
    cb_submittal: true,
    cb_product_data: false,
    cb_samples: false,
    cb_shop_drawings: false,
    cb_om_manuals: false,
    cb_plans: false,
    cb_letters: false,
    cb_specifications: false,
    cb_prints: false,
    cb_addenda: false,
    cb_change_orders: false,
    cb_sds_safety: false,
    cb_arch_drawings: false,
    cb_invoices: false,
    cb_eng_drawings: false,
    show_for_column: false,
    include_paint_floor: false,
    include_wc_floor: false,
    combine_enclosures: false,
    use_excel_template: false,
    include_paint_sheet: false,
    include_wc_sheet: false,
    paint_submittal_nums: [],
    wc_submittal_nums: [],
    remarks: DEFAULT_TRANSMITTAL_REMARK,
    copies_to: "",
    signer_name: "",
    enclosures: [emptyEnclosure()],
    pending_submittal_queue: [],
  };
}

export function formatToday(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatTodayLong(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function parseProjectTradeData(raw: Json | null | undefined): ProjectTradeData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProjectTradeData;
}

export function paintItemDescription(item: PaintItem): string {
  const color = [item.manufacturer, item.color].filter((p) => p.trim()).join(" ").trim();
  const parts = [item.label, color, item.product, item.sheen].filter((p) => p.trim());
  return parts.join(" - ");
}

export function paintItemToTransmittalDescription(item: PaintItem, includeFloor: boolean): string {
  const label = item.label.trim();
  const floor = item.floor.trim();
  const color = [item.manufacturer, item.color].filter((p) => p.trim()).join(" ").trim();
  const product = item.product.trim();
  const sheen = item.sheen.trim();
  if (!label && !color && !product && !sheen) return "";
  const parts = [label, includeFloor ? floor : null, color, product, sheen].filter(Boolean);
  return parts.join(" - ");
}

export function wallcoveringItemToTransmittalDescription(
  item: WallcoveringItem,
  includeFloor: boolean,
): string {
  const label = item.label.trim();
  const floor = item.floor.trim();
  const mfr = item.manufacturer.trim();
  const product = item.product.trim();
  const color = item.color.trim();
  const qty = item.qty.trim();
  const notes = item.notes.trim();
  if (!label && !product && !color) return "";
  const parts = [label, includeFloor ? floor : null, mfr, product, color, qty, notes].filter(Boolean);
  return parts.join(" - ");
}
