import type { Json } from "./database.generated";
import { normalizeTransmittalContract, type TransmittalContract } from "../lib/jobInfo";
import {
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_SCAN_ENHANCE,
  normalizeDisplayPrefs,
  normalizeScanEnhance,
  type WorkOrderDisplayPrefs,
  type ScanEnhanceSettings,
} from "./workOrderScan";
import { defaultTextSpacing, normalizeTextSpacing, type WorkOrderTextSpacing } from "../lib/workOrderOverlayLayout";

export type MaterialLine = {
  name: string;
  price: number;
  quantity: number;
  markup_percent: number;
  tax_percent: number;
};

export type OverlaySection = "material" | "labor" | "total" | "custom";

/** Draggable text on the work order document — aligned with desktop OverlayText. */
export type WorkOrderOverlay = {
  id: string;
  section: OverlaySection;
  /** Material name, labor label, or total key (e.g. "Grand Total"). */
  label: string;
  /** Rate / unit price display string. */
  price: string;
  /** Formatted currency amount on the document. */
  amount: string;
  hours: string | null;
  quantity: string | null;
  color: string;
  /** PDF-space X from left (612×792 letter). */
  x: number;
  /** PDF-space Y from top. */
  y: number;
  font_size: number;
};

export type WorkOrderSourceMedia = "pdf" | "image";

export type WorkOrderFormData = {
  hours: number;
  labor_rate_name: string;
  labor_billing_rate: number;
  labor_raw_rate_per_hour: number;
  raw_cost: number;
  indirects: number | null;
  labor_cost: number;
  material_cost: number;
  total_amount: number;
  notes: string;
  gc_checked: boolean;
  fsi_checked: boolean;
  material_lines: MaterialLine[];
  /** Supabase Storage path for uploaded PDF/image. */
  source_storage_path: string;
  source_media_type: WorkOrderSourceMedia | null;
  source_pdf_page: number;
  source_pdf_page_count: number;
  page_width: number;
  page_height: number;
  overlay_color: string;
  overlays: WorkOrderOverlay[];
  display: WorkOrderDisplayPrefs;
  scan_enhance: ScanEnhanceSettings;
  text_spacing: WorkOrderTextSpacing;
  /** Billing contract identity for this EWO */
  contract: TransmittalContract;
};

export type { WorkOrderDisplayPrefs, ScanEnhanceSettings } from "./workOrderScan";
export type { WorkOrderTextSpacing } from "../lib/workOrderOverlayLayout";

export type WorkOrderRow = {
  id: string;
  project_id: string;
  ewo_number: string;
  ewo_date: string;
  total_amount: number;
  material_cost: number;
  labor_cost: number;
  delivered: boolean;
  status: string;
  data: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;

export function defaultWorkOrderFormData(): WorkOrderFormData {
  return {
    hours: 0,
    labor_rate_name: "",
    labor_billing_rate: 0,
    labor_raw_rate_per_hour: 0,
    raw_cost: 0,
    indirects: null,
    labor_cost: 0,
    material_cost: 0,
    total_amount: 0,
    notes: "",
    gc_checked: false,
    fsi_checked: false,
    material_lines: [],
    source_storage_path: "",
    source_media_type: null,
    source_pdf_page: 0,
    source_pdf_page_count: 1,
    page_width: LETTER_WIDTH,
    page_height: LETTER_HEIGHT,
    overlay_color: "#DC2626",
    overlays: [],
    display: { ...DEFAULT_DISPLAY_PREFS },
    scan_enhance: { ...DEFAULT_SCAN_ENHANCE },
    text_spacing: defaultTextSpacing(),
    contract: "paint",
  };
}

function parseOverlay(raw: unknown): WorkOrderOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "");
  if (!id) return null;
  return {
    id,
    section: (["material", "labor", "total", "custom"].includes(String(o.section))
      ? o.section
      : "custom") as OverlaySection,
    label: String(o.label ?? ""),
    price: String(o.price ?? ""),
    amount: String(o.amount ?? ""),
    hours: o.hours != null ? String(o.hours) : null,
    quantity: o.quantity != null ? String(o.quantity) : null,
    color: String(o.color ?? "#DC2626"),
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    font_size: Number(o.font_size) || 14,
  };
}

export function parseWorkOrderData(raw: unknown): WorkOrderFormData {
  const base = defaultWorkOrderFormData();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;

  const lines = Array.isArray(o.material_lines)
    ? o.material_lines.map((line) => {
        const l = line as Record<string, unknown>;
        return {
          name: String(l.name ?? ""),
          price: Number(l.price) || 0,
          quantity: Number(l.quantity) || 1,
          markup_percent: Number(l.markup_percent) || 0,
          tax_percent: Number(l.tax_percent) || 0,
        };
      })
    : [];

  const overlays = Array.isArray(o.overlays)
    ? o.overlays.map(parseOverlay).filter((x): x is WorkOrderOverlay => x !== null)
    : [];

  const media = o.source_media_type === "pdf" || o.source_media_type === "image" ? o.source_media_type : null;

  return {
    ...base,
    hours: Number(o.hours) || 0,
    labor_rate_name: String(o.labor_rate_name ?? ""),
    labor_billing_rate: Number(o.labor_billing_rate) || 0,
    labor_raw_rate_per_hour: Number(o.labor_raw_rate_per_hour) || 0,
    raw_cost: Number(o.raw_cost) || 0,
    indirects: o.indirects == null || o.indirects === "" ? null : Number(o.indirects) || 0,
    labor_cost: Number(o.labor_cost) || 0,
    material_cost: Number(o.material_cost) || 0,
    total_amount: Number(o.total_amount) || 0,
    notes: String(o.notes ?? ""),
    gc_checked: Boolean(o.gc_checked),
    fsi_checked: Boolean(o.fsi_checked),
    material_lines: lines,
    source_storage_path: String(o.source_storage_path ?? ""),
    source_media_type: media,
    source_pdf_page: Number(o.source_pdf_page) || 0,
    source_pdf_page_count: Number(o.source_pdf_page_count) || 1,
    page_width: Number(o.page_width) || LETTER_WIDTH,
    page_height: Number(o.page_height) || LETTER_HEIGHT,
    overlay_color: String(o.overlay_color ?? "#DC2626"),
    overlays,
    display: normalizeDisplayPrefs(o.display),
    scan_enhance: normalizeScanEnhance(o.scan_enhance),
    text_spacing: normalizeTextSpacing(o.text_spacing),
    contract: normalizeTransmittalContract(o.contract),
  };
}
