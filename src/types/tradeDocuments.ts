import type { Json } from "./database";

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
};

export type TradeSubmittalType = "new" | "revised" | "substitution" | "original";

export type PaintSubmittalData = {
  submittal_number: number;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: PaintItem[];
};

export type WallcoveringSubmittalData = {
  submittal_number: number;
  submittal_type: TradeSubmittalType;
  subject: string;
  date: string;
  items: WallcoveringItem[];
};

export type TransmittalEnclosure = {
  description: string;
  included: boolean;
  copies: string;
  for_field: string;
  digital_copy: boolean;
};

export type TransmittalData = {
  transmittal_number: number;
  date: string;
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
  remarks: string;
  copies_to: string;
  signer_name: string;
  enclosures: TransmittalEnclosure[];
};

export type ProjectTradeData = {
  paint_submittal?: PaintSubmittalData;
  wallcovering_submittal?: WallcoveringSubmittalData;
  transmittal?: TransmittalData;
};

export const PAINT_SUBMITTAL_TYPES: { id: TradeSubmittalType; label: string }[] = [
  { id: "new", label: "New brush outs" },
  { id: "revised", label: "Revised" },
  { id: "substitution", label: "Color substitution" },
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
  return { label: "", floor: "", manufacturer: "", product: "", color: "" };
}

export function emptyEnclosure(): TransmittalEnclosure {
  return { description: "", included: true, copies: "1", for_field: "", digital_copy: false };
}

export function defaultPaintSubmittal(): PaintSubmittalData {
  return {
    submittal_number: 1,
    submittal_type: "new",
    subject: paintSubjectForType("new"),
    date: formatToday(),
    items: [emptyPaintItem()],
  };
}

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
    transmittal_number: 1,
    date: formatTodayLong(),
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
    show_for_column: true,
    remarks: "",
    copies_to: "",
    signer_name: "",
    enclosures: [emptyEnclosure()],
  };
}

function formatToday(): string {
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
