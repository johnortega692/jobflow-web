import { loadRawUserSettings } from "./budgetLibrary";
import { normalizeGoogleUrls } from "./googleSheetsConfig";
import { loadDefaultPaintVendorsFromJson, type PaintVendor } from "./paintVendorEmail";
import { loadPaintUserSettingsFromRaw } from "./paintUserSettingsLoad";
import type { TrackerEmailSchedule } from "./trackerEmailSchedule";

export type { PaintVendor } from "./paintVendorEmail";
import type { EmailSignatureSettings } from "./emailSignature";
export type { EmailSignatureSettings } from "./emailSignature";

export type SuperEmail = { name: string; email: string };

export type BrushoutPrepRecord = {
  prep_id: string;
  site_location?: string;
  gc?: string;
  internal_reference?: string;
  paint_vendor?: string;
  status?: string;
  emailed_date?: string;
  linked_job_key?: string;
  linked_at?: string;
  created?: string;
  last_modified?: string;
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
  /** Primary To address for paint tracker approval/revision notifications (legacy EMAIL_CONFIG.PRIMARY). */
  notification_primary_email: string;
  /** Display name in notification subjects/headers (legacy EMAIL_CONFIG.PRIMARY_NAME). */
  notification_primary_name: string;
  super_emails: SuperEmail[];
  default_brushout_qty: number;
  brushout_preps: BrushoutPrepRecord[];
  vendors: PaintVendor[];
  signature: EmailSignatureSettings;
  /** Vercel cron auto-send for follow-up reminders and weekly digests. */
  tracker_email_schedule: TrackerEmailSchedule;
};

export async function loadPaintUserSettings(userId: string): Promise<PaintUserSettings> {
  const raw = await loadRawUserSettings(userId);
  let vendorsOverride: PaintVendor[] | undefined;
  const hasVendors =
    Array.isArray(raw.vendors) &&
    (raw.vendors as PaintVendor[]).some((v) => v?.vendor_email?.trim());
  if (!hasVendors) {
    vendorsOverride = await loadDefaultPaintVendorsFromJson();
  }
  const settings = loadPaintUserSettingsFromRaw(raw, vendorsOverride);
  settings.google_urls = normalizeGoogleUrls(settings.google_urls as Record<string, string>);
  return settings;
}

export { DEFAULT_TRACKER_EMAIL_SCHEDULE, type TrackerEmailSchedule } from "./trackerEmailSchedule";

export function listOpenBrushoutPreps(preps: BrushoutPrepRecord[]): BrushoutPrepRecord[] {
  return preps.filter((p) => {
    const status = (p.status || "open").toLowerCase();
    return status === "open" || status === "brushouts_emailed";
  });
}
