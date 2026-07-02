import type { Json } from "./database";
import type { BudgetMakerData } from "./budgetMaker";
import type { PaintTrackerState, WcTrackerLineState, WcTrackerState } from "./fieldTracker";
import { formatSubmittalDisplayDate } from "../lib/dateInputUtils";
import { normalizeTransmittalContract, type TransmittalContract } from "../lib/jobInfo";
import { normalizeTransmittalNumbersOnRead } from "../lib/transmittalPerContract";
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

export type SubmittalIssueStatus =
  | "draft"
  | "issued"
  | "approved"
  | "approved_as_noted"
  | "revise_resubmit"
  | "closed";

/** Log / transmittal package category (matches submittal log). */
export type SubmittalPackageCategory =
  | "Paint Product Data"
  | "Paint Brush-Outs / Color Samples"
  | "Wallcovering Product Data"
  | "Wallcovering Samples"
  | "FRP Product Data"
  | "FRP Samples"
  | "SDS/TDS Packet"
  | "Other";

export const SUBMITTAL_PACKAGE_CATEGORIES: SubmittalPackageCategory[] = [
  "Paint Product Data",
  "Paint Brush-Outs / Color Samples",
  "Wallcovering Product Data",
  "Wallcovering Samples",
  "FRP Product Data",
  "FRP Samples",
  "SDS/TDS Packet",
  "Other",
];

export const PAINT_PACKAGE_TYPE_OPTIONS: { id: SubmittalPackageCategory; label: string }[] = [
  { id: "Paint Brush-Outs / Color Samples", label: "Paint Brush-Outs / Color Samples" },
  { id: "Paint Product Data", label: "Paint Product Data" },
  { id: "Other", label: "Other" },
];

export const WALLCOVERING_PACKAGE_TYPE_OPTIONS: { id: SubmittalPackageCategory; label: string }[] = [
  { id: "Wallcovering Samples", label: "Wallcovering Samples" },
  { id: "Wallcovering Product Data", label: "Wallcovering Product Data" },
  { id: "Other", label: "Other" },
];

export const FRP_PACKAGE_TYPE_OPTIONS: { id: SubmittalPackageCategory; label: string }[] = [
  { id: "FRP Product Data", label: "FRP Product Data" },
  { id: "FRP Samples", label: "FRP Samples" },
  { id: "Other", label: "Other" },
];

export type SubmittalPackageScope = "paint" | "wallcovering" | "frp";

export function defaultPackageForScope(scope: SubmittalPackageScope): SubmittalPackageCategory {
  if (scope === "wallcovering") return "Wallcovering Samples";
  if (scope === "frp") return "FRP Product Data";
  return "Paint Brush-Outs / Color Samples";
}

const LEGACY_PACKAGE_BY_SCOPE: Record<SubmittalPackageScope, Record<string, SubmittalPackageCategory>> = {
  paint: {
    "Product Data": "Paint Product Data",
    "Color Samples": "Paint Brush-Outs / Color Samples",
    "Shop Drawings": "Other",
    Substitution: "Other",
  },
  wallcovering: {
    "Product Data": "Wallcovering Product Data",
    "Color Samples": "Wallcovering Samples",
    "Shop Drawings": "Other",
    Substitution: "Other",
  },
  frp: {
    "Product Data": "FRP Product Data",
    "Color Samples": "FRP Samples",
    "Shop Drawings": "Other",
    Substitution: "Other",
  },
};

export function normalizePackageCategory(
  value: unknown,
  fallback: SubmittalPackageCategory,
  scope?: SubmittalPackageScope,
): SubmittalPackageCategory {
  const raw = String(value ?? "").trim();
  if (SUBMITTAL_PACKAGE_CATEGORIES.includes(raw as SubmittalPackageCategory)) {
    return raw as SubmittalPackageCategory;
  }
  if (scope && LEGACY_PACKAGE_BY_SCOPE[scope][raw]) {
    return LEGACY_PACKAGE_BY_SCOPE[scope][raw];
  }
  if (raw === "Product Data") {
    return fallback.includes("Wallcovering")
      ? "Wallcovering Product Data"
      : fallback.includes("FRP")
        ? "FRP Product Data"
        : "Paint Product Data";
  }
  if (raw === "Color Samples") {
    return fallback.includes("Wallcovering")
      ? "Wallcovering Samples"
      : fallback.includes("FRP")
        ? "FRP Samples"
        : "Paint Brush-Outs / Color Samples";
  }
  if (raw === "Shop Drawings" || raw === "Substitution") return "Other";
  return fallback;
}

export const SUBMITTAL_ISSUE_STATUSES: { id: SubmittalIssueStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "issued", label: "Issued" },
  { id: "approved", label: "Approved" },
  { id: "approved_as_noted", label: "Approved As Noted" },
  { id: "revise_resubmit", label: "Revise & Resubmit" },
  { id: "closed", label: "Closed" },
];

export function normalizeRevisionNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

export function normalizeSubmittalIssueStatus(value: unknown): SubmittalIssueStatus {
  const raw = String(value ?? "draft").trim().toLowerCase() as SubmittalIssueStatus;
  return SUBMITTAL_ISSUE_STATUSES.some((s) => s.id === raw) ? raw : "draft";
}

export type PaintSubmittalData = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
  package_type: SubmittalPackageCategory;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: PaintItem[];
  /** Why this revision was created — shown on PDF when revision &gt; 0. */
  revision_note?: string;
  submittal_ordered?: boolean;
  paint_vendor?: string;
  brushout_prep?: BrushoutPrepLink;
  /** Last pushed brush-out line per label+floor key (merge wave tracking). */
  brushout_pushed?: Record<string, string>;
  /** When false, hide floor column in UI and omit floor grouping on PDF. */
  show_floor?: boolean;
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
  revision_number: number;
  date: string;
  items: PaintItem[] | WallcoveringItem[] | FrpItem[];
  package_type?: SubmittalPackageCategory;
  submittal_type?: TradeSubmittalType;
  scope?: "paint" | "wallcovering" | "frp";
  issue_status?: SubmittalIssueStatus;
  revision_note?: string;
  /** Prior revisions are locked once a new revision is created or the package is issued. */
  locked?: boolean;
};

export type WallcoveringSubmittalData = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
  package_type: SubmittalPackageCategory;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: WallcoveringItem[];
  revision_note?: string;
  got_track?: boolean;
  submittal_ordered?: boolean;
};

export type FrpItem = {
  manufacturer: string;
  product: string;
  color: string;
  quantity: string;
  notes: string;
  label: string;
  panel_size: string;
  trim_size: string;
  /** Include in Orders by Vendor */
  order: boolean;
};

export type FrpSubmittalData = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
  package_type: SubmittalPackageCategory;
  subject: string;
  date: string;
  revision_note?: string;
  items: FrpItem[];
};

export type TrackItemType = "Track" | "Infill" | "";

export type TrackItem = {
  type: TrackItemType;
  product: string;
  mat_code: string;
  quantity: string;
  /** Include in Orders by Vendor */
  order: boolean;
};

export type TrackSubmittalData = {
  items: TrackItem[];
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
  /** Formatted transmittal id, e.g. TR-001 (active contract tab) */
  transmittal_number: string;
  /** Per-contract transmittal sequences when job has distinct trade contracts */
  transmittal_numbers?: Partial<Record<TransmittalContract, string>>;
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
  include_paint_sheet: boolean;
  include_wc_sheet: boolean;
  include_frp_sheet: boolean;
  paint_submittal_nums: number[];
  wc_submittal_nums: number[];
  frp_submittal_nums: number[];
  remarks: string;
  copies_to: string;
  signer_name: string;
  enclosures: TransmittalEnclosure[];
  pending_submittal_queue: PendingSubmittalItem[];
  /** Which contract identity appears on the transmittal cover sheet */
  contract: TransmittalContract;
};

/** Record of a generated transmittal package (for review / reload). */
export type TransmittalHistoryEntry = {
  id: string;
  transmittal_number: string;
  date: string;
  subject: string;
  job_number: string;
  job_name: string;
  contract: TransmittalContract;
  generated_at: string;
  combined: boolean;
  appended_sheets: number;
  include_paint_sheet: boolean;
  include_wc_sheet: boolean;
  include_frp_sheet: boolean;
  paint_submittal_nums: number[];
  wc_submittal_nums: number[];
  frp_submittal_nums: number[];
  enclosure_count: number;
  missing_warnings: string[];
  /** Full transmittal state at time of download (before number bump). */
  snapshot: TransmittalData;
};

export type ProjectTradeData = {
  paint_submittal?: PaintSubmittalData;
  paint_submittal_history?: SubmittalHistoryEntry[];
  wallcovering_submittal?: WallcoveringSubmittalData;
  wallcovering_submittal_history?: SubmittalHistoryEntry[];
  frp_submittal?: FrpSubmittalData;
  frp_submittal_history?: SubmittalHistoryEntry[];
  track_submittal?: TrackSubmittalData;
  transmittal?: TransmittalData;
  transmittal_history?: TransmittalHistoryEntry[];
  sds_packet?: SdsPacketData;
  budget_maker?: BudgetMakerData;
  paint_tracker?: PaintTrackerState;
  wc_tracker?: WcTrackerState;
  wc_tracker_lines?: WcTrackerLineState[];
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
  /** Which contract identity appears on the package cover and PDF filename */
  contract: TransmittalContract;
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
    contract: "paint",
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
    contract: normalizeTransmittalContract(raw.contract),
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

export function paintSubjectForPackage(
  packageType: SubmittalPackageCategory,
  submittalType: TradeSubmittalType,
): string {
  if (packageType === "Paint Product Data") return "Paint Product Data";
  return paintSubjectForType(submittalType);
}

export function wcSubjectForPackage(
  packageType: SubmittalPackageCategory,
  submittalType: TradeSubmittalType,
): string {
  if (packageType === "Wallcovering Product Data") return "Wallcovering Product Data";
  return wcSubjectForType(submittalType);
}

export function frpSubjectForPackage(packageType: SubmittalPackageCategory): string {
  if (packageType === "FRP Samples") return "FRP Samples";
  return "FRP Product Data";
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

export function emptyFrpItem(): FrpItem {
  return {
    manufacturer: "",
    product: "",
    color: "",
    quantity: "",
    notes: "",
    label: "",
    panel_size: "",
    trim_size: "",
    order: false,
  };
}

export function emptyTrackItem(): TrackItem {
  return { type: "", product: "", mat_code: "", quantity: "", order: false };
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
  const contract = normalizeTransmittalContract(raw.contract);
  const { transmittal_number, transmittal_numbers } = normalizeTransmittalNumbersOnRead(raw, contract);
  return {
    ...base,
    ...raw,
    transmittal_number,
    transmittal_numbers,
    subject: raw.subject?.trim() ?? base.subject,
    enclosures: (raw.enclosures?.length ? raw.enclosures : base.enclosures).map(normalizeEnclosure),
    pending_submittal_queue: (raw.pending_submittal_queue ?? []).map(normalizePendingItem),
    paint_submittal_nums: [...(raw.paint_submittal_nums ?? [])],
    wc_submittal_nums: [...(raw.wc_submittal_nums ?? [])],
    frp_submittal_nums: [...(raw.frp_submittal_nums ?? [])],
    contract,
  };
}

export function defaultPaintSubmittal(): PaintSubmittalData {
  return {
    submittal_number: 1,
    revision_number: 0,
    issue_status: "draft",
    package_type: "Paint Brush-Outs / Color Samples",
    submittal_type: "new",
    subject: paintSubjectForType("new"),
    date: formatToday(),
    items: [emptyPaintItem()],
    submittal_ordered: false,
    paint_vendor: "PPG",
    show_floor: false,
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
    revision_number: 0,
    issue_status: "draft",
    package_type: "Paint Brush-Outs / Color Samples",
    submittal_type: "new",
    subject: wcSubjectForType("new"),
    date: formatToday(),
    items: [emptyWallcoveringItem()],
    submittal_ordered: false,
  };
}

export function normalizePaintSubmittal(raw: Partial<PaintSubmittalData> | null | undefined): PaintSubmittalData {
  const base = defaultPaintSubmittal();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    items: (raw.items?.length ? raw.items : base.items).map((i) => ({ ...emptyPaintItem(), ...i })),
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: normalizePackageCategory(raw.package_type, "Paint Brush-Outs / Color Samples", "paint"),
    revision_note: raw.revision_note?.trim() || undefined,
    show_floor: raw.show_floor === true,
    brushout_pushed:
      raw.brushout_pushed && typeof raw.brushout_pushed === "object"
        ? Object.fromEntries(
            Object.entries(raw.brushout_pushed).map(([k, v]) => [k, String(v)]),
          )
        : undefined,
    date: formatSubmittalDisplayDate((raw.date ?? base.date).trim()) || formatToday(),
  };
}

export function normalizeWallcoveringSubmittal(
  raw: Partial<WallcoveringSubmittalData> | null | undefined,
): WallcoveringSubmittalData {
  const base = defaultWallcoveringSubmittal();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    items: (raw.items?.length ? raw.items : base.items).map((i) => ({ ...emptyWallcoveringItem(), ...i })),
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: normalizePackageCategory(raw.package_type, "Wallcovering Samples", "wallcovering"),
    revision_note: raw.revision_note?.trim() || undefined,
    date: formatSubmittalDisplayDate((raw.date ?? base.date).trim()) || formatToday(),
  };
}

export function normalizeFrpSubmittal(raw: Partial<FrpSubmittalData> | null | undefined): FrpSubmittalData {
  const base = defaultFrpSubmittal();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    items: (raw.items?.length ? raw.items : base.items).map((i) => ({ ...emptyFrpItem(), ...i, order: i.order ?? false })),
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: normalizePackageCategory(raw.package_type, "FRP Product Data", "frp"),
    subject: raw.subject?.trim() || frpSubjectForPackage(normalizePackageCategory(raw.package_type, "FRP Product Data", "frp")),
    date: formatSubmittalDisplayDate((raw.date?.trim() || base.date).trim()) || formatToday(),
    revision_note: raw.revision_note?.trim() || undefined,
  };
}

export function defaultFrpSubmittal(): FrpSubmittalData {
  return {
    submittal_number: 1,
    revision_number: 0,
    issue_status: "draft",
    package_type: "FRP Product Data",
    subject: frpSubjectForPackage("FRP Product Data"),
    date: formatToday(),
    items: [emptyFrpItem()],
  };
}

export function defaultTrackSubmittal(): TrackSubmittalData {
  return {
    items: [emptyTrackItem()],
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
    include_paint_sheet: false,
    include_wc_sheet: false,
    include_frp_sheet: false,
    paint_submittal_nums: [],
    wc_submittal_nums: [],
    frp_submittal_nums: [],
    remarks: DEFAULT_TRANSMITTAL_REMARK,
    copies_to: "",
    signer_name: "",
    enclosures: [emptyEnclosure()],
    pending_submittal_queue: [],
    contract: "paint",
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
