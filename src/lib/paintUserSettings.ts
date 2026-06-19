import { loadRawUserSettings } from "./budgetLibrary";
import {
  DEFAULT_EMAIL_SIGNATURE,
  normalizeEmailSignature,
  type EmailSignatureSettings,
} from "./emailSignature";
import { loadDefaultPaintVendorsFromJson, type PaintVendor } from "./paintVendorEmail";

export type { PaintVendor } from "./paintVendorEmail";
export type { EmailSignatureSettings } from "./emailSignature";

export type SuperEmail = { name: string; email: string };

export type BrushoutPrepRecord = {
  prep_id: string;
  site_location?: string;
  gc?: string;
  internal_reference?: string;
  status?: string;
  emailed_date?: string;
  paint_items?: {
    label?: string;
    manufacturer?: string;
    floor?: string;
    color?: string;
    product?: string;
    sheen?: string;
    previous_color?: string;
  }[];
  line_count?: number;
};

export type PaintUserSettings = {
  google_urls: Record<string, string>;
  user_name: string;
  super_emails: SuperEmail[];
  default_brushout_qty: number;
  brushout_preps: BrushoutPrepRecord[];
  vendors: PaintVendor[];
  signature: EmailSignatureSettings;
};

export async function loadPaintUserSettings(userId: string): Promise<PaintUserSettings> {
  const raw = await loadRawUserSettings(userId);
  const google =
    raw.google_urls && typeof raw.google_urls === "object" && !Array.isArray(raw.google_urls)
      ? (raw.google_urls as Record<string, string>)
      : {};
  const superEmails = Array.isArray(raw.super_emails)
    ? (raw.super_emails as SuperEmail[]).filter((s) => s?.email?.trim())
    : [];
  const qty = typeof raw.default_brushout_qty === "number" ? raw.default_brushout_qty : 6;
  const preps = Array.isArray(raw.brushout_preps)
    ? (raw.brushout_preps as BrushoutPrepRecord[])
    : [];

  let vendors: PaintVendor[] = [];
  if (Array.isArray(raw.vendors)) {
    vendors = (raw.vendors as PaintVendor[]).filter((v) => v?.vendor_email?.trim());
  }
  if (!vendors.length) {
    vendors = await loadDefaultPaintVendorsFromJson();
  }

  const signature = raw.signature
    ? normalizeEmailSignature(raw.signature)
    : { ...DEFAULT_EMAIL_SIGNATURE };

  return {
    google_urls: google,
    user_name: typeof raw.user_name === "string" ? raw.user_name : "",
    super_emails: superEmails,
    default_brushout_qty: qty,
    brushout_preps: preps,
    vendors,
    signature,
  };
}

export function listOpenBrushoutPreps(preps: BrushoutPrepRecord[]): BrushoutPrepRecord[] {
  return preps.filter((p) => {
    const status = (p.status || "open").toLowerCase();
    return status === "open" || status === "brushouts_emailed";
  });
}
