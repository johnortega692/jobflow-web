import type { Json } from "./database.js";
import type { BudgetMakerData } from "./budgetMaker.js";
import type { PaintTrackerState, WcTrackerLineState, WcTrackerState } from "./fieldTracker.js";
import { formatSubmittalDisplayDate } from "../lib/dateInputUtils.js";
import { gcCompanyName } from "../lib/gcCompanyName.js";
import { normalizeTransmittalContract, type TransmittalContract } from "../lib/jobInfo.js";
import { normalizeTransmittalNumbersOnRead } from "../lib/transmittalPerContract.js";
import { DEFAULT_TRANSMITTAL_REMARK } from "../lib/transmittalRemarks.js";
import { normalizeSdsSection as normalizeSdsSectionRow, sortSdsSectionsBySpec } from "../lib/sdsSectionModel.js";
import { applyPaintAutoLabels, paintItemsSuggestAutoLabel } from "../lib/paintItemLabels.js";
import { groupPaintItemsForPackage, paintPackageSectionsFromGroups } from "../lib/paintPackageLink.js";
import { applyFrpAutoLabels, frpItemsSuggestAutoLabel, parseFrpQtyField } from "../lib/frpItemLabels.js";
import { applyWcAutoLabels, parseWcQtyField, wcItemsHaveFloor, wcItemsSuggestAutoLabel } from "../lib/wcItemLabels.js";
import { migrateTrackItems, normalizeWcComponents, refreshComponentTags } from "../lib/wcComponents";

/** Paint dual-table model is binary (`primary` | `secondary`); chip UI is capped to match. */
export const MAX_PAINT_SPEC_SECTIONS = 2;

/** Which CSI table a paint line belongs to when optional 2nd spec is enabled. */
export type PaintItemSpecScope = "primary" | "secondary";

export type PaintRevisionChange = "NEW" | "REVISED" | "No Change" | "Removed";

export const PAINT_REVISION_CHANGE_CYCLE: PaintRevisionChange[] = [
  "REVISED",
  "NEW",
  "No Change",
  "Removed",
];

export function parsePaintRevisionChange(raw: unknown): PaintRevisionChange | undefined {
  return raw === "NEW" || raw === "REVISED" || raw === "No Change" || raw === "Removed"
    ? raw
    : undefined;
}

export function nextPaintRevisionChange(current: PaintRevisionChange): PaintRevisionChange {
  const index = PAINT_REVISION_CHANGE_CYCLE.indexOf(current);
  return PAINT_REVISION_CHANGE_CYCLE[(index + 1) % PAINT_REVISION_CHANGE_CYCLE.length]!;
}

export type PaintItem = {
  label: string;
  floor: string;
  manufacturer: string;
  color: string;
  /** Approximate catalog hex when color lookup resolves (display swatch). */
  color_hex?: string;
  product: string;
  sheen: string;
  previous_color: string;
  /** Manual GC PDF status on a revision. When omitted, compared to the previous issued package. */
  revision_change?: PaintRevisionChange;
  /** Defaults to primary. Used when package has an optional 2nd spec. */
  spec_scope?: PaintItemSpecScope;
  /**
   * Primer chosen on this finish. Null follows the product's paired primer.
   * "none" is an explicit self-priming override. A uuid overrides to that primer.
   */
  primer_override_id?: string | null;
  /** When true, the row stays on the submittal but is left out of the downloaded PDF. */
  pdf_hidden?: boolean;
};

/** Stored primer_override_id when the finish is explicitly self-priming. */
export const PAINT_PRIMER_OVERRIDE_NONE = "none";

/** Order-form unit of measure (vendor-facing). */
export type MaterialOrderUnit =
  | "EA"
  | "LF"
  | "YD"
  | "SF"
  | "SY"
  | "LY"
  | "BX"
  | "RL"
  | "GAL"
  | "PC"
  | "CS"
  | "PL";

export const MATERIAL_ORDER_UNITS: MaterialOrderUnit[] = [
  "EA",
  "LF",
  "YD",
  "SF",
  "SY",
  "LY",
  "BX",
  "RL",
  "GAL",
  "PC",
  "CS",
  "PL",
];

/** @deprecated Use MaterialOrderUnit */
export type TrackOrderUnit = MaterialOrderUnit;
/** @deprecated Use MATERIAL_ORDER_UNITS */
export const TRACK_ORDER_UNITS = MATERIAL_ORDER_UNITS;

export type WallcoveringItem = {
  label: string;
  floor: string;
  manufacturer: string;
  product: string;
  color: string;
  previous_color: string;
  qty: string;
  /** Unit of measure for material orders; defaults to EA. */
  unit: MaterialOrderUnit | string;
  notes: string;
  /** Optional product page for sample labels. */
  product_page_url: string;
  panels: boolean;
  include_in_submittal: boolean;
  /** Include in Orders by Vendor / Order Samples */
  order: boolean;
  /** Defaults to primary. Used when package has an optional 2nd spec. */
  spec_scope?: PaintItemSpecScope;
  components?: import("../lib/wcComponents").WcComponent[];
  fabricatedAssembly?: boolean;
  shopDrawings?: boolean;
  e84ClassA?: boolean;
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
  /**
   * Ordered CSI sections for this package. Index 0 is the lead section.
   * Paint UI caps at {@link MAX_PAINT_SPEC_SECTIONS} (binary item scopes).
   * Optional on legacy drafts; {@link normalizePaintSubmittal} always fills it.
   */
  spec_sections?: string[];
  /**
   * Mirror of `spec_sections[0]` for downstream PDF/log/transmittal readers.
   * // TODO: remove once downstream reads leadSpecSection()
   */
  spec_section: string;
  /**
   * @deprecated Read-path compat only. Prefer `spec_sections[1]`. No longer written.
   */
  spec_section_secondary?: string;
  /**
   * @deprecated Never stored custom text; derived from CSI title. Read-path compat only.
   */
  spec_section_secondary_label?: string;
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
  /** When true, labels are A, B, C… by row order and read-only. */
  auto_label?: boolean;
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
  spec_section?: string;
  /** Optional 2nd CSI when the issued paint package used dual specs. */
  spec_section_secondary?: string;
  spec_section_secondary_label?: string;
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
  /**
   * Ordered CSI sections. Index 0 is lead. Capped at {@link MAX_PAINT_SPEC_SECTIONS}.
   */
  spec_sections?: string[];
  /**
   * Mirror of `spec_sections[0]` for PDF/log/transmittal.
   * // TODO: remove once downstream reads leadSpecSection()
   */
  spec_section: string;
  date: string;
  items: WallcoveringItem[];
  revision_note?: string;
  got_track?: boolean;
  submittal_ordered?: boolean;
  /** When true, content-row labels follow W-1, W-2… order. */
  auto_label?: boolean;
  /** When true, Floor control is shown on content-row secondary tiers. */
  show_floor?: boolean;
};

export type FrpItem = {
  manufacturer: string;
  product: string;
  color: string;
  quantity: string;
  /** Unit of measure for material orders; defaults to EA. */
  unit: MaterialOrderUnit | string;
  notes: string;
  label: string;
  panel_size: string;
  trim_size: string;
  /** Include in Orders by Vendor */
  order: boolean;
  /** Include this row on the FRP submittal PDF (default true). */
  include_in_submittal: boolean;
};

export type FrpSubmittalData = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
  package_type: SubmittalPackageCategory;
  subject: string;
  /** CSI / specification section shown on the submittal PDF and transmittal enclosure. */
  spec_section: string;
  date: string;
  revision_note?: string;
  items: FrpItem[];
  /** When true, item labels follow F-1, F-2… order. */
  auto_label?: boolean;
};

export type TrackItemType = "Track" | "Infill" | "";

export type TrackItem = {
  type: TrackItemType;
  product: string;
  mat_code: string;
  quantity: string;
  /** Unit of measure for material orders; defaults to EA. */
  unit: MaterialOrderUnit | string;
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
  /** False when the row was filed by New transmittal before a PDF was downloaded. */
  downloaded?: boolean;
  /** Full transmittal state when it was downloaded or filed. */
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
  /** Earlier product packages. The working package stays in `sds_packet`. */
  sds_packet_history?: SdsPacketData[];
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
} from "../lib/sdsPacketPresets.js";

export type { SdsPacketType } from "../lib/sdsPacketPresets.js";
export {
  SDS_PACKET_TYPES,
  coverMainTitle,
  defaultCoverPurpose,
  isPresetCoverPurpose,
  resolveCoverPurpose,
  sdsPacketFilename,
} from "../lib/sdsPacketPresets.js";

import type { SdsSectionAttachments, SdsSectionCategory } from "../lib/sdsSectionModel.js";

export type { SdsSectionCategory } from "../lib/sdsSectionModel.js";

export type PaintPackageScheduleRow = {
  labels: string[];
  finish: string;
  manufacturer: string;
  sheen: string;
  /** Catalog primer id. Null when the finish is self-priming or has no primer. */
  primer_id: string | null;
  primer_name: string;
  self_priming: boolean;
};

export type PaintPackageScheduleProduct = {
  product: string;
  use: string;
  tds: boolean;
  sds: boolean;
  voc: string;
  manufacturer: string;
};

/** System Schedule rows saved with an sds_packet_history snapshot. */
export type PaintPackageScheduleSnapshot = {
  spec_section: string;
  rows: PaintPackageScheduleRow[];
  /** Package section ids in primer-then-finish product-data order. */
  section_order: string[];
  products: PaintPackageScheduleProduct[];
};

function normalizeScheduleText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePaintPackageSchedule(raw: unknown): PaintPackageScheduleSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.rows)) return undefined;
  const rows: PaintPackageScheduleRow[] = [];
  for (const entry of record.rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const finish = normalizeScheduleText(row.finish);
    if (!finish) continue;
    const labels = Array.isArray(row.labels)
      ? row.labels.map(normalizeScheduleText).filter(Boolean)
      : [];
    const primerId = normalizeScheduleText(row.primer_id);
    rows.push({
      labels,
      finish,
      manufacturer: normalizeScheduleText(row.manufacturer),
      sheen: normalizeScheduleText(row.sheen),
      primer_id: primerId || null,
      primer_name: normalizeScheduleText(row.primer_name),
      self_priming: row.self_priming === true,
    });
  }
  const section_order = Array.isArray(record.section_order)
    ? record.section_order.map(normalizeScheduleText).filter(Boolean)
    : [];
  const products: PaintPackageScheduleProduct[] = [];
  if (Array.isArray(record.products)) {
    for (const entry of record.products) {
      if (!entry || typeof entry !== "object") continue;
      const product = entry as Record<string, unknown>;
      const name = normalizeScheduleText(product.product);
      if (!name) continue;
      products.push({
        product: name,
        use: normalizeScheduleText(product.use),
        tds: product.tds === true,
        sds: product.sds === true,
        voc: normalizeScheduleText(product.voc),
        manufacturer: normalizeScheduleText(product.manufacturer),
      });
    }
  }
  return {
    spec_section: normalizeScheduleText(record.spec_section),
    rows,
    section_order,
    products,
  };
}

export type SdsSection = {
  id: string;
  category: SdsSectionCategory;
  /** CSI / specification section for this product row (packet may mix multiple). */
  spec_section: string;
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
  /**
   * @deprecated Packet-level CSI removed — use each section's `spec_section`.
   * Kept optional for legacy JSON; normalize migrates onto empty section rows then clears.
   */
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
  /**
   * Resolved System Schedule frozen when this package was saved to history.
   * Absent on a live draft and on older snapshots; those still compute from current paint items.
   */
  paint_schedule?: PaintPackageScheduleSnapshot;
};

export function newSdsSectionId(): string {
  return crypto.randomUUID();
}

export function emptySdsSection(): SdsSection {
  return normalizeSdsSectionRow({});
}

export function defaultSdsPacket(): SdsPacketData {
  const packet_type: SdsPacketType = "Product Information";
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
  const legacyPacketSpec =
    typeof raw.spec_section === "string" ? raw.spec_section.trim() : "";
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s) => {
        const row = normalizeSdsSectionRow(s as Parameters<typeof normalizeSdsSectionRow>[0]);
        if (!row.spec_section.trim() && legacyPacketSpec) {
          return { ...row, spec_section: legacyPacketSpec };
        }
        return row;
      })
    : base.sections;
  return {
    ...base,
    ...raw,
    packet_type,
    cover_title: raw.cover_title?.trim() ?? base.cover_title,
    cover_purpose: isPresetCoverPurpose(packet_type, raw.cover_purpose ?? "")
      ? defaultCoverPurpose(packet_type)
      : raw.cover_purpose?.trim() || defaultCoverPurpose(packet_type),
    cover_subtitle: "",
    // Packet-level CSI retired — sections own their CSI.
    spec_section: "",
    include_cover: raw.include_cover ?? base.include_cover,
    include_toc: raw.include_toc ?? base.include_toc,
    include_dividers: raw.include_dividers ?? base.include_dividers,
    include_stamp: raw.include_stamp ?? base.include_stamp,
    include_end: raw.include_end ?? base.include_end,
    add_to_submittal_log: raw.add_to_submittal_log ?? base.add_to_submittal_log,
    add_to_transmittal: raw.add_to_transmittal ?? base.add_to_transmittal,
    contract: normalizeTransmittalContract(raw.contract),
    sections: sortSdsSectionsBySpec(sections),
    paint_schedule: normalizePaintPackageSchedule(raw.paint_schedule),
  };
}

export function normalizeSdsPacketHistory(raw: unknown): SdsPacketData[] {
  if (!Array.isArray(raw)) return [];
  const byNumber = new Map<number, SdsPacketData>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const packet = normalizeSdsPacket(row as Partial<SdsPacketData>);
    if (!packet.submittal_number) continue;
    byNumber.set(packet.submittal_number, packet);
  }
  return [...byNumber.values()].sort((a, b) => b.submittal_number - a.submittal_number);
}

/** Replace the snapshot for this package number, or add it. */
export function upsertSdsPacketHistory(history: SdsPacketData[], packet: SdsPacketData): SdsPacketData[] {
  const snap = normalizeSdsPacket(packet);
  const rest = history.filter((row) => row.submittal_number !== snap.submittal_number);
  return [snap, ...rest].sort((a, b) => b.submittal_number - a.submittal_number);
}

export function nextSdsPackageNumber(history: SdsPacketData[], currentNumber: number): number {
  const used = history.map((row) => row.submittal_number);
  used.push(currentNumber);
  return Math.min(99, Math.max(0, ...used) + 1);
}

/** Archive the working package when it has sections, then start the next empty package. */
export function startNewSdsPackage(
  current: SdsPacketData,
  history: SdsPacketData[],
): { draft: SdsPacketData; history: SdsPacketData[] } {
  const nextHistory = current.sections.length ? upsertSdsPacketHistory(history, current) : history;
  const fresh = defaultSdsPacket();
  return {
    history: nextHistory,
    draft: {
      ...fresh,
      packet_type: current.packet_type,
      preparer: current.preparer,
      cover_purpose: current.cover_purpose,
      include_cover: current.include_cover,
      include_toc: current.include_toc,
      include_dividers: current.include_dividers,
      include_stamp: current.include_stamp,
      include_end: current.include_end,
      add_to_submittal_log: current.add_to_submittal_log,
      add_to_transmittal: current.add_to_transmittal,
      contract: current.contract,
      submittal_number: nextSdsPackageNumber(nextHistory, current.submittal_number),
    },
  };
}

export function sdsSectionsFromPaintItems(
  items: PaintItem[],
  defaultSpecSection = "",
  specForItem?: (item: PaintItem) => string,
): SdsSection[] {
  const fallback = defaultSpecSection.trim();
  const groups = groupPaintItemsForPackage(items, (item) => specForItem?.(item)?.trim() || fallback);
  return paintPackageSectionsFromGroups(groups);
}

export function sdsSectionsFromWallcoveringItems(
  items: WallcoveringItem[],
  defaultSpecSection = "",
): SdsSection[] {
  const seen = new Set<string>();
  const out: SdsSection[] = [];
  const defaultSpec = defaultSpecSection.trim();
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
      spec_section: defaultSpec,
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
  packet: Pick<SdsPacketData, "packet_type" | "cover_title" | "submittal_number"> & {
    spec_section?: string;
    sections?: SdsSection[];
  },
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

/** Same type ids as paint revisions; wallcovering-facing labels for Start revision from history. */
export const REVISED_WALLCOVERING_SUBMITTAL_TYPES: {
  id: TradeSubmittalType;
  label: string;
  hint: string;
}[] = [
  {
    id: "revised",
    label: "Revised wallcovering",
    hint: "Changes to products already on the original submittal",
  },
  {
    id: "new",
    label: "New wallcovering",
    hint: "Additional wallcovering items added to the original package",
  },
  {
    id: "substitution",
    label: "Material substitution",
    hint: "Replace an approved material on the same label",
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

function normalizePrimerOverrideId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
}

export function emptyPaintItem(): PaintItem {
  return {
    label: "",
    floor: "",
    manufacturer: "",
    color: "",
    color_hex: "",
    product: "",
    sheen: "",
    previous_color: "",
    spec_scope: "primary",
    primer_override_id: null,
    pdf_hidden: false,
  };
}

export function paintItemSpecScope(item: PaintItem): PaintItemSpecScope {
  return item.spec_scope === "secondary" ? "secondary" : "primary";
}

function dedupeSpecSections(sections: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sections) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Resolve ordered CSI list from new or legacy paint fields. */
export function normalizePaintSpecSections(
  raw: Partial<PaintSubmittalData> | null | undefined,
): string[] {
  if (Array.isArray(raw?.spec_sections) && raw.spec_sections.length) {
    return dedupeSpecSections(raw.spec_sections.map((s) => String(s ?? "")));
  }
  return dedupeSpecSections([
    typeof raw?.spec_section === "string" ? raw.spec_section : "",
    typeof raw?.spec_section_secondary === "string" ? raw.spec_section_secondary : "",
  ]);
}

export function leadSpecSection(
  data: Pick<PaintSubmittalData, "spec_sections" | "spec_section">,
): string {
  const lead = data.spec_sections?.[0]?.trim();
  if (lead) return lead;
  return data.spec_section?.trim() ?? "";
}

/** True when a 2nd CSI table should show (chip[1] present). */
export function paintDualSpecEnabled(data: Pick<PaintSubmittalData, "spec_sections">): boolean {
  return (data.spec_sections?.length ?? 0) >= 2;
}

/** Short label derived from CSI title (e.g. "Exterior Painting"). */
export function paintSpecSectionShortLabel(section: string, fallback = "Secondary"): string {
  const raw = section.trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s*[-–—]\s*/);
  const title = parts.length > 1 ? parts.slice(1).join(" – ").trim() : "";
  return title || raw || fallback;
}

export function paintScopeForSpecIndex(index: number): PaintItemSpecScope | null {
  if (index === 0) return "primary";
  if (index === 1) return "secondary";
  return null;
}

/**
 * Persist ordered specs + lead mirror. Does not write secondary legacy fields.
 * Caps length at {@link MAX_PAINT_SPEC_SECTIONS}.
 */
export function withPaintSpecSections(
  draft: PaintSubmittalData,
  sections: string[],
): PaintSubmittalData {
  const spec_sections = dedupeSpecSections(sections).slice(0, MAX_PAINT_SPEC_SECTIONS);
  return {
    ...draft,
    spec_sections,
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: spec_sections[0] ?? "",
    spec_section_secondary: undefined,
    spec_section_secondary_label: undefined,
  };
}

export type RemovePaintSpecResult =
  | { ok: true; draft: PaintSubmittalData }
  | { ok: false; blocked: true; message: string };

/**
 * Remove a CSI chip. Blocks (with message) when items use that scope unless `confirmed`.
 * After removal, folds secondary lines to primary when fewer than 2 sections remain.
 */
export function removePaintSpecSection(
  draft: PaintSubmittalData,
  index: number,
  options?: { confirmed?: boolean },
): RemovePaintSpecResult {
  const sections = [...(draft.spec_sections ?? [])];
  if (index < 0 || index >= sections.length) {
    return { ok: true, draft };
  }
  const scope = paintScopeForSpecIndex(index);
  const itemCount =
    scope == null
      ? 0
      : draft.items.filter((item) => paintItemSpecScope(item) === scope).length;

  if (itemCount > 0 && !options?.confirmed) {
    const label = sections[index] ?? "this section";
    return {
      ok: false,
      blocked: true,
      message: `${itemCount} paint line(s) are under “${label}”. Remove the section and move those lines to the remaining table?`,
    };
  }

  sections.splice(index, 1);
  let items = draft.items;
  if (sections.length < 2) {
    items = items.map((item) =>
      paintItemSpecScope(item) === "secondary" ? { ...item, spec_scope: "primary" as const } : item,
    );
  }
  return { ok: true, draft: withPaintSpecSections({ ...draft, items }, sections) };
}

export function addPaintSpecSection(
  draft: PaintSubmittalData,
  section: string,
): PaintSubmittalData {
  const value = section.trim();
  if (!value) return draft;
  const current = draft.spec_sections ?? [];
  if (current.includes(value) || current.length >= MAX_PAINT_SPEC_SECTIONS) return draft;
  return withPaintSpecSections(draft, [...current, value]);
}

/** @deprecated Use paintDualSpecEnabled — kept so untouched print code still compiles. */
export function paintSecondarySpecEnabled(
  data: Pick<PaintSubmittalData, "spec_sections" | "spec_section_secondary">,
): boolean {
  return paintDualSpecEnabled(data) || Boolean(data.spec_section_secondary?.trim());
}

/** @deprecated Use paintSpecSectionShortLabel(spec_sections[1]) — kept for untouched print. */
export function paintSecondarySpecLabel(
  data: Pick<PaintSubmittalData, "spec_sections" | "spec_section_secondary" | "spec_section_secondary_label">,
): string {
  const section =
    data.spec_sections?.[1]?.trim() || data.spec_section_secondary?.trim() || "";
  return paintSpecSectionShortLabel(section);
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
    unit: "LY",
    notes: "",
    product_page_url: "",
    panels: false,
    include_in_submittal: true,
    order: false,
    spec_scope: "primary",
    components: [],
    fabricatedAssembly: false,
    shopDrawings: false,
    e84ClassA: false,
  };
}

export function wcItemSpecScope(item: WallcoveringItem): PaintItemSpecScope {
  return item.spec_scope === "secondary" ? "secondary" : "primary";
}

/** Resolve ordered CSI list from wallcovering draft fields. */
export function normalizeWcSpecSections(
  raw: Partial<WallcoveringSubmittalData> | null | undefined,
): string[] {
  if (Array.isArray(raw?.spec_sections) && raw.spec_sections.length) {
    return dedupeSpecSections(raw.spec_sections.map((s) => String(s ?? "")));
  }
  return dedupeSpecSections([typeof raw?.spec_section === "string" ? raw.spec_section : ""]);
}

/** True when a 2nd CSI table should show (chip[1] present). */
export function wcDualSpecEnabled(data: Pick<WallcoveringSubmittalData, "spec_sections">): boolean {
  return (data.spec_sections?.length ?? 0) >= 2;
}

/**
 * Persist ordered specs + lead mirror for wallcovering.
 * Caps length at {@link MAX_PAINT_SPEC_SECTIONS}.
 */
export function withWcSpecSections(
  draft: WallcoveringSubmittalData,
  sections: string[],
): WallcoveringSubmittalData {
  const spec_sections = dedupeSpecSections(sections).slice(0, MAX_PAINT_SPEC_SECTIONS);
  return {
    ...draft,
    spec_sections,
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: spec_sections[0] ?? "",
  };
}

export type RemoveWcSpecResult =
  | { ok: true; draft: WallcoveringSubmittalData }
  | { ok: false; blocked: true; message: string };

/**
 * Remove a CSI chip. Blocks when content items use that scope unless `confirmed`.
 * Track/infill rows are always treated as primary and ignored for the secondary count.
 * After removal, folds secondary lines to primary when fewer than 2 sections remain.
 */
export function removeWcSpecSection(
  draft: WallcoveringSubmittalData,
  index: number,
  options?: { confirmed?: boolean },
): RemoveWcSpecResult {
  const sections = [...(draft.spec_sections ?? [])];
  if (index < 0 || index >= sections.length) {
    return { ok: true, draft };
  }
  const scope = paintScopeForSpecIndex(index);
  const itemCount =
    scope == null
      ? 0
      : draft.items.filter((item) => {
          // Track/infill stays with primary; never counts against secondary removal.
          if (
            item.product.trim() === "Track and Infill" &&
            item.manufacturer.trim().toUpperCase() === "APS"
          ) {
            return false;
          }
          return wcItemSpecScope(item) === scope;
        }).length;

  if (itemCount > 0 && !options?.confirmed) {
    const label = sections[index] ?? "this section";
    return {
      ok: false,
      blocked: true,
      message: `${itemCount} wallcovering line(s) are under “${label}”. Remove the section and move those lines to the remaining table?`,
    };
  }

  sections.splice(index, 1);
  let items = draft.items;
  if (sections.length < 2) {
    items = items.map((item) =>
      wcItemSpecScope(item) === "secondary" ? { ...item, spec_scope: "primary" as const } : item,
    );
  }
  return { ok: true, draft: withWcSpecSections({ ...draft, items }, sections) };
}

export function addWcSpecSection(
  draft: WallcoveringSubmittalData,
  section: string,
): WallcoveringSubmittalData {
  const value = section.trim();
  if (!value) return draft;
  const current = draft.spec_sections ?? [];
  if (current.includes(value) || current.length >= MAX_PAINT_SPEC_SECTIONS) return draft;
  return withWcSpecSections(draft, [...current, value]);
}

export function emptyFrpItem(): FrpItem {
  return {
    manufacturer: "",
    product: "",
    color: "",
    quantity: "",
    unit: "EA",
    notes: "",
    label: "",
    panel_size: "",
    trim_size: "",
    order: false,
    include_in_submittal: true,
  };
}

export function emptyTrackItem(): TrackItem {
  return { type: "", product: "", mat_code: "", quantity: "", unit: "LF", order: false };
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
    description: stripPdfFilenameFromDescription(raw.description?.trim() ?? ""),
    included: raw.included ?? true,
    copies: raw.copies?.trim() || "1",
    for_field: raw.for_field?.trim() ?? "",
    digital_copy: raw.digital_copy ?? false,
    log_row_id: raw.log_row_id?.trim() || undefined,
    pending_id: raw.pending_id?.trim() || undefined,
  };
}

function stripPdfFilenameFromDescription(description: string): string {
  return description.replace(/\s*\(([^()]+\.pdf)\)\s*$/i, "").trim();
}

export function normalizePendingItem(raw: Partial<PendingSubmittalItem> | null | undefined): PendingSubmittalItem {
  const rawObj = raw ?? {};
  return {
    id: rawObj.id?.trim() || crypto.randomUUID(),
    submittal_type: rawObj.submittal_type?.trim() || "Product Data",
    scope: rawObj.scope == null ? "Paint" : rawObj.scope.trim(),
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
    gc_name: gcCompanyName(raw.gc_name ?? ""),
    enclosures: (raw.enclosures?.length ? raw.enclosures : base.enclosures).map(normalizeEnclosure),
    pending_submittal_queue: (raw.pending_submittal_queue ?? []).map(normalizePendingItem),
    paint_submittal_nums: [...(raw.paint_submittal_nums ?? [])],
    wc_submittal_nums: [...(raw.wc_submittal_nums ?? [])],
    frp_submittal_nums: [...(raw.frp_submittal_nums ?? [])],
    contract,
  };
}

export function defaultPaintSubmittal(): PaintSubmittalData {
  const lead = "09 91 23 - Interior Painting";
  return {
    submittal_number: 1,
    revision_number: 0,
    issue_status: "draft",
    package_type: "Paint Brush-Outs / Color Samples",
    submittal_type: "new",
    subject: paintSubjectForType("new"),
    spec_sections: [lead],
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: lead,
    date: formatToday(),
    items: [emptyPaintItem()],
    submittal_ordered: false,
    paint_vendor: "PPG",
    show_floor: false,
    auto_label: false,
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
  const lead = "09 72 00 - Wall Coverings";
  return {
    submittal_number: 1,
    revision_number: 0,
    issue_status: "draft",
    package_type: "Wallcovering Samples",
    submittal_type: "new",
    subject: wcSubjectForType("new"),
    spec_sections: [lead],
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: lead,
    date: formatToday(),
    items: applyWcAutoLabels([emptyWallcoveringItem()]),
    submittal_ordered: false,
    auto_label: true,
    show_floor: false,
  };
}

export function normalizePaintSubmittal(raw: Partial<PaintSubmittalData> | null | undefined): PaintSubmittalData {
  const base = defaultPaintSubmittal();
  if (!raw) return base;
  const items = (raw.items?.length ? raw.items : base.items).map((i) => ({
    ...emptyPaintItem(),
    ...i,
    color_hex: typeof i.color_hex === "string" ? i.color_hex.trim() : "",
    revision_change: parsePaintRevisionChange(i.revision_change),
    spec_scope: i.spec_scope === "secondary" ? ("secondary" as const) : ("primary" as const),
    primer_override_id: normalizePrimerOverrideId(i.primer_override_id),
    pdf_hidden: i.pdf_hidden === true,
  }));
  const auto_label =
    typeof raw.auto_label === "boolean" ? raw.auto_label : paintItemsSuggestAutoLabel(items);
  const resolved = normalizePaintSpecSections(raw);
  const spec_sections = resolved.length ? resolved : [...(base.spec_sections ?? [base.spec_section])];
  return {
    ...base,
    ...raw,
    items: auto_label ? applyPaintAutoLabels(items) : items,
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: "Paint Brush-Outs / Color Samples",
    subject:
      !raw.subject?.trim() || raw.subject.trim() === "Paint Product Data"
        ? paintSubjectForType(
            raw.submittal_type === "revised" ||
              raw.submittal_type === "substitution" ||
              raw.submittal_type === "original"
              ? raw.submittal_type
              : "new",
          )
        : raw.subject,
    revision_note: raw.revision_note?.trim() || undefined,
    spec_sections,
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: spec_sections[0] ?? base.spec_section,
    // Stop writing legacy secondary fields; keep read-path via normalizePaintSpecSections.
    spec_section_secondary: undefined,
    spec_section_secondary_label: undefined,
    show_floor: raw.show_floor === true,
    auto_label,
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
  const items = (raw.items?.length ? raw.items : base.items).map((i) => {
    const merged = {
      ...emptyWallcoveringItem(),
      ...i,
      product_page_url: typeof i.product_page_url === "string" ? i.product_page_url.trim() : "",
      order: i.order ?? false,
      spec_scope: i.spec_scope === "secondary" ? ("secondary" as const) : ("primary" as const),
    };
    const parsed = parseWcQtyField(merged.qty, i.unit?.trim() || merged.unit, "LY");
    return {
      ...merged,
      qty: parsed.qty,
      unit: parsed.unit,
      components: normalizeWcComponents(i.components, String(i.label ?? "")),
      fabricatedAssembly: Boolean(i.fabricatedAssembly),
      shopDrawings: Boolean(i.shopDrawings),
      e84ClassA: Boolean(i.e84ClassA),
    };
  });
  const migrated = migrateTrackItems(items);
  const auto_label =
    typeof raw.auto_label === "boolean" ? raw.auto_label : wcItemsSuggestAutoLabel(migrated);
  const labeled = refreshComponentTags(auto_label ? applyWcAutoLabels(migrated) : migrated);
  const resolved = normalizeWcSpecSections(raw);
  const spec_sections = resolved.length ? resolved : [...(base.spec_sections ?? [base.spec_section])];
  return {
    ...base,
    ...raw,
    items: labeled,
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: "Wallcovering Samples",
    subject:
      !raw.subject?.trim() || raw.subject.trim() === "Wallcovering Product Data"
        ? wcSubjectForType(
            raw.submittal_type === "revised" ||
              raw.submittal_type === "substitution" ||
              raw.submittal_type === "original"
              ? raw.submittal_type
              : "new",
          )
        : raw.subject,
    revision_note: raw.revision_note?.trim() || undefined,
    spec_sections,
    // TODO: remove once downstream reads leadSpecSection()
    spec_section: spec_sections[0] ?? base.spec_section,
    auto_label,
    show_floor: raw.show_floor === true || wcItemsHaveFloor(labeled),
    date: formatSubmittalDisplayDate((raw.date ?? base.date).trim()) || formatToday(),
  };
}

export function normalizeFrpSubmittal(raw: Partial<FrpSubmittalData> | null | undefined): FrpSubmittalData {
  const base = defaultFrpSubmittal();
  if (!raw) return base;
  const items = (raw.items?.length ? raw.items : base.items).map((i) => {
    const merged = {
      ...emptyFrpItem(),
      ...i,
      order: i.order ?? false,
      include_in_submittal: i.include_in_submittal !== false,
    };
    const parsed = parseFrpQtyField(merged.quantity, i.unit?.trim() || merged.unit, "EA");
    return { ...merged, quantity: parsed.quantity, unit: parsed.unit };
  });
  const auto_label =
    typeof raw.auto_label === "boolean" ? raw.auto_label : frpItemsSuggestAutoLabel(items);
  return {
    ...base,
    ...raw,
    items: auto_label ? applyFrpAutoLabels(items) : items,
    revision_number: normalizeRevisionNumber(raw.revision_number),
    issue_status: normalizeSubmittalIssueStatus(raw.issue_status),
    package_type: normalizePackageCategory(raw.package_type, "FRP Product Data", "frp"),
    subject: raw.subject?.trim() || frpSubjectForPackage(normalizePackageCategory(raw.package_type, "FRP Product Data", "frp")),
    spec_section: typeof raw.spec_section === "string" ? raw.spec_section.trim() : base.spec_section,
    date: formatSubmittalDisplayDate((raw.date?.trim() || base.date).trim()) || formatToday(),
    revision_note: raw.revision_note?.trim() || undefined,
    auto_label,
  };
}

export function defaultFrpSubmittal(): FrpSubmittalData {
  return {
    submittal_number: 1,
    revision_number: 0,
    issue_status: "draft",
    package_type: "FRP Product Data",
    subject: frpSubjectForPackage("FRP Product Data"),
    spec_section: "06 60 00 - Plastic Fabrications (FRP)",
    date: formatToday(),
    items: applyFrpAutoLabels([emptyFrpItem()]),
    auto_label: true,
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
