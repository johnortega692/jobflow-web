/** User-editable letterhead / PDF signature settings (stored in Supabase per user). */

export type LetterheadSettings = {
  company_name: string;
  company_address: string;
  company_phone: string;
  company_license: string;
  logo_url: string;
  signer_name: string;
  signer_title: string;
  signer_phone: string;
  signer_email: string;
};

export const emptyLetterheadSettings = (): LetterheadSettings => ({
  company_name: "",
  company_address: "",
  company_phone: "",
  company_license: "",
  logo_url: "",
  signer_name: "",
  signer_title: "",
  signer_phone: "",
  signer_email: "",
});

export function coerceLetterheadSettings(raw: unknown): LetterheadSettings {
  const base = emptyLetterheadSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    company_name: String(o.company_name ?? ""),
    company_address: String(o.company_address ?? ""),
    company_phone: String(o.company_phone ?? ""),
    company_license: String(o.company_license ?? ""),
    logo_url: String(o.logo_url ?? ""),
    signer_name: String(o.signer_name ?? ""),
    signer_title: String(o.signer_title ?? ""),
    signer_phone: String(o.signer_phone ?? ""),
    signer_email: String(o.signer_email ?? ""),
  };
}

/** Trim fields — use when loading from DB or saving, not on every keystroke. */
export function normalizeLetterheadSettings(raw: unknown): LetterheadSettings {
  const s = coerceLetterheadSettings(raw);
  return {
    company_name: s.company_name.trim(),
    company_address: s.company_address.trim(),
    company_phone: s.company_phone.trim(),
    company_license: s.company_license.trim(),
    logo_url: s.logo_url.trim(),
    signer_name: s.signer_name.trim(),
    signer_title: s.signer_title.trim(),
    signer_phone: s.signer_phone.trim(),
    signer_email: s.signer_email.trim(),
  };
}
