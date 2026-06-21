import {
  DEFAULT_EMAIL_SIGNATURE,
  normalizeEmailSignature,
  type EmailSignatureSettings,
} from "./emailSignature";
import type { PaintVendor } from "./paintVendorEmail";
import { normalizeTrackerEmailSchedule, type TrackerEmailSchedule } from "./trackerEmailSchedule";
import type { BrushoutPrepRecord, PaintUserSettings, SuperEmail } from "./paintUserSettings";

export function loadPaintUserSettingsFromRaw(
  raw: Record<string, unknown>,
  vendorsOverride?: PaintVendor[],
): PaintUserSettings {
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
  if (!vendors.length && vendorsOverride?.length) {
    vendors = vendorsOverride;
  }

  const signature = raw.signature
    ? normalizeEmailSignature(raw.signature)
    : { ...DEFAULT_EMAIL_SIGNATURE };

  const userName = typeof raw.user_name === "string" ? raw.user_name : "";
  const notificationPrimaryEmail =
    typeof raw.notification_primary_email === "string" ? raw.notification_primary_email.trim() : "";
  const notificationPrimaryName =
    typeof raw.notification_primary_name === "string"
      ? raw.notification_primary_name.trim()
      : userName.trim();

  return {
    google_urls: google,
    user_name: userName,
    notification_primary_email: notificationPrimaryEmail,
    notification_primary_name: notificationPrimaryName,
    super_emails: superEmails,
    default_brushout_qty: qty,
    brushout_preps: preps,
    vendors,
    signature,
    tracker_email_schedule: normalizeTrackerEmailSchedule(raw.tracker_email_schedule),
  };
}

export type { TrackerEmailSchedule };
