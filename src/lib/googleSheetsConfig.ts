export type GoogleUrlKey = "paint_tracker" | "field_request_order";

export const GOOGLE_URL_FIELDS: { key: GoogleUrlKey; title: string; hint: string }[] = [
  {
    key: "paint_tracker",
    title: "Dashboard Web App URL",
    hint: "Gmail send for paint tracker notifications, follow-up/install reminders, and weekly digests. Deploy as Execute as: Me.",
  },
  {
    key: "field_request_order",
    title: "Field Request Order URL",
    hint: "Field Tools order emails with PDF attachments (?action=sendOrderEmail). Must match Supabase edge secret GAS_SEND_EMAIL_URL.",
  },
];

export const DEFAULT_GOOGLE_URLS: Record<GoogleUrlKey, string> = {
  paint_tracker: "",
  field_request_order: "",
};

export const PAINT_VENDOR_OPTIONS = [
  "PPG",
  "Sherwin Williams",
  "Benjamin Moore",
  "Dunn Edwards",
  "Vista",
] as const;

export type PaintVendorLabel = (typeof PAINT_VENDOR_OPTIONS)[number];

export const PAINT_VENDOR_CODES: Record<PaintVendorLabel, string> = {
  PPG: "PPG",
  "Sherwin Williams": "SW",
  "Benjamin Moore": "BM",
  "Dunn Edwards": "DE",
  Vista: "VISTA",
};

export function normalizeGoogleUrls(raw: Record<string, string> | undefined): Record<GoogleUrlKey, string> {
  const out = { ...DEFAULT_GOOGLE_URLS };
  if (!raw) return out;
  for (const { key } of GOOGLE_URL_FIELDS) {
    const v = raw[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

export function validateGoogleUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("https://script.google.com/macros/s/")) {
    return "URL must start with https://script.google.com/macros/s/";
  }
  return null;
}

export function validateGoogleUrls(urls: Record<string, string>): string | null {
  for (const { key, title } of GOOGLE_URL_FIELDS) {
    const err = validateGoogleUrl(urls[key] ?? "");
    if (err) return `${title}: ${err}`;
  }
  return null;
}

export type GoogleSheetsProjectFields = {
  sheet_job_info: string;
  sheet_start_date: string;
  sheet_gc: string;
  sheet_location: string;
  paint_vendor: PaintVendorLabel;
  user_name: string;
  nights: boolean;
};

export function defaultGoogleSheetsProjectFields(): GoogleSheetsProjectFields {
  return {
    sheet_job_info: "",
    sheet_start_date: "",
    sheet_gc: "",
    sheet_location: "",
    paint_vendor: "PPG",
    user_name: "",
    nights: false,
  };
}

export function parseGoogleSheetsProjectFields(raw: unknown): GoogleSheetsProjectFields {
  const base = defaultGoogleSheetsProjectFields();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const vendor = String(o.paint_vendor ?? base.paint_vendor);
  return {
    sheet_job_info: String(o.sheet_job_info ?? ""),
    sheet_start_date: String(o.sheet_start_date ?? ""),
    sheet_gc: String(o.sheet_gc ?? ""),
    sheet_location: String(o.sheet_location ?? ""),
    paint_vendor: PAINT_VENDOR_OPTIONS.includes(vendor as PaintVendorLabel)
      ? (vendor as PaintVendorLabel)
      : base.paint_vendor,
    user_name: String(o.user_name ?? ""),
    nights: Boolean(o.nights),
  };
}
