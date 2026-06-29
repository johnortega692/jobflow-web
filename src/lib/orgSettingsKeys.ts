/** Settings stored in org_settings (shared company-wide; admin writes). */
export const ORG_SETTINGS_KEYS = [
  "company_name",
  "company_address",
  "company_phone",
  "company_license",
  "logo_url",
  "pdf_show",
  "material_vendors",
  "architects",
  "delivery_scheduling",
  "paint_products",
  "paint_sheens",
  "vendors",
  "super_emails",
  "project_staff_pms",
  "notification_primary_email",
  "notification_primary_name",
  "default_brushout_qty",
  "tracker_email_schedule",
  "work_order_materials",
  "work_order_labor_rates",
  "work_order_fonts",
] as const;

/** Per-user settings (each account keeps their own row). */
export const PERSONAL_SETTINGS_KEYS = [
  "signer_name",
  "signer_title",
  "signer_phone",
  "signer_email",
  "user_name",
  "brushout_preps",
  "signature",
  "work_order_display",
  "work_order_scan_boxes",
  "work_order_total_positions",
  "work_order_text_spacing",
  "budget_library",
  "compose_email_method",
] as const;

const ORG_KEY_SET = new Set<string>(ORG_SETTINGS_KEYS);
const PERSONAL_KEY_SET = new Set<string>(PERSONAL_SETTINGS_KEYS);

export function pickOrgSettingsPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (ORG_KEY_SET.has(key)) out[key] = value;
  }
  return out;
}

export function pickPersonalSettingsPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (PERSONAL_KEY_SET.has(key)) out[key] = value;
  }
  return out;
}

export function mergeOrgAndPersonalSettings(
  org: Record<string, unknown>,
  personal: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...org };
  for (const key of PERSONAL_SETTINGS_KEYS) {
    if (personal[key] !== undefined) merged[key] = personal[key];
  }
  return merged;
}

export function stripOrgKeysFromPersonalBlob(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ORG_KEY_SET.has(key) && key !== "google_urls") out[key] = value;
  }
  return out;
}
