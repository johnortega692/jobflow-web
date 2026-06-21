/** User-editable letterhead / PDF signature settings (stored in Supabase per user). */

/** Per-field visibility on printed PDFs (RFIs, submittals, transmittals, etc.). */
export type LetterheadPdfVisibility = {
  logo: boolean;
  company_name: boolean;
  company_address: boolean;
  company_phone: boolean;
  company_license: boolean;
  signer_name: boolean;
  signer_title: boolean;
  signer_phone: boolean;
  signer_email: boolean;
};

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
  pdf_show: LetterheadPdfVisibility;
};

export const defaultLetterheadPdfVisibility = (): LetterheadPdfVisibility => ({
  logo: true,
  company_name: true,
  company_address: true,
  company_phone: true,
  company_license: true,
  signer_name: true,
  signer_title: true,
  signer_phone: true,
  signer_email: true,
});

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
  pdf_show: defaultLetterheadPdfVisibility(),
});

function coercePdfVisibility(raw: unknown, fallback: LetterheadPdfVisibility): LetterheadPdfVisibility {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  const bool = (key: keyof LetterheadPdfVisibility) =>
    typeof o[key] === "boolean" ? (o[key] as boolean) : fallback[key];
  return {
    logo: bool("logo"),
    company_name: bool("company_name"),
    company_address: bool("company_address"),
    company_phone: bool("company_phone"),
    company_license: bool("company_license"),
    signer_name: bool("signer_name"),
    signer_title: bool("signer_title"),
    signer_phone: bool("signer_phone"),
    signer_email: bool("signer_email"),
  };
}

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
    pdf_show: coercePdfVisibility(o.pdf_show, base.pdf_show),
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
    pdf_show: s.pdf_show,
  };
}
