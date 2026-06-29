import { loadRawUserSettings, patchOrgSettings, patchUserSettings } from "./budgetLibrary";
import { supabase } from "./supabase";
import {
  defaultLetterheadPdfVisibility,
  emptyLetterheadSettings,
  normalizeLetterheadSettings,
  type LetterheadPdfVisibility,
  type LetterheadSettings,
} from "../types/letterheadSettings";
import type { PrintBranding } from "./printCore";
import { buildCompanyContactLine, normalizeLogoUrl } from "./printCore";
import { resolveDisplayCompanyName } from "./displayCompanyName";

const STORAGE_KEY = "jobflow-letterhead-v1";


function envFallback(): Partial<LetterheadSettings> {
  return {
    company_name: import.meta.env.VITE_COMPANY_NAME?.trim() || "",
    company_address: import.meta.env.VITE_COMPANY_ADDRESS?.trim() || "",
    company_phone: import.meta.env.VITE_COMPANY_PHONE?.trim() || "",
    company_license: import.meta.env.VITE_COMPANY_LICENSE?.trim() || "",
    logo_url: import.meta.env.VITE_LOGO_URL?.trim() || "",
    signer_name: import.meta.env.VITE_SIGNER_NAME?.trim() || "",
    signer_title: "",
    signer_phone: import.meta.env.VITE_COMPANY_PHONE?.trim() || "",
    signer_email: import.meta.env.VITE_SIGNER_EMAIL?.trim() || "",
  };
}

function mergeSettings(saved: LetterheadSettings, env: Partial<LetterheadSettings>): LetterheadSettings {
  const pick = (key: keyof Omit<LetterheadSettings, "pdf_show">) => saved[key] || env[key] || "";
  return {
    company_name: pick("company_name"),
    company_address: pick("company_address"),
    company_phone: pick("company_phone"),
    company_license: pick("company_license"),
    logo_url: pick("logo_url"),
    signer_name: pick("signer_name"),
    signer_title: pick("signer_title"),
    signer_phone: pick("signer_phone"),
    signer_email: pick("signer_email"),
    pdf_show: saved.pdf_show,
  };
}

function applyPdfVisibility(
  show: LetterheadPdfVisibility,
  values: {
    companyName: string;
    companyAddress: string;
    companyPhone: string;
    companyLicense: string;
    logoUrl: string;
    signerName: string;
    signerTitle: string;
    signerPhone: string;
    signerEmail: string;
  },
) {
  const companyName = show.company_name ? values.companyName : "";
  const companyAddress = show.company_address ? values.companyAddress : "";
  const companyPhone = show.company_phone ? values.companyPhone : "";
  const companyLicense = show.company_license ? values.companyLicense : "";
  const logoUrl = show.logo ? values.logoUrl : "";
  const signerName = show.signer_name ? values.signerName : "";
  const signerTitle = show.signer_title ? values.signerTitle : "";
  const signerPhone = show.signer_phone ? values.signerPhone : "";
  const signerEmail = show.signer_email ? values.signerEmail : "";
  const companyContactLine = buildCompanyContactLine(companyAddress, companyPhone, companyLicense);
  const fromParts = [companyName, companyAddress].filter(Boolean);
  const fromBlock = fromParts.join("\n");

  return {
    companyName,
    companyAddress,
    companyPhone,
    companyLicense,
    companyInfo: companyContactLine,
    companyContactLine,
    logoUrl,
    logoAlt: companyName || values.companyName,
    footerName: signerName,
    footerPhone: signerPhone,
    footerEmail: signerEmail,
    fromBlock,
    fromPhone: signerPhone || companyPhone,
    signerName,
    signerTitle,
    signerPhone,
    signerEmail,
    pdfShow: show,
  };
}

export function letterheadToPrintBranding(settings: LetterheadSettings): PrintBranding {
  const show = settings.pdf_show ?? defaultLetterheadPdfVisibility();
  const companyName = resolveDisplayCompanyName(settings.company_name.trim() || "Plan B Apps");
  const companyAddress = settings.company_address.trim();
  const companyPhone = settings.company_phone.trim();
  const companyLicense = settings.company_license.trim();
  const signerName = settings.signer_name.trim() || companyName;
  const signerPhone = settings.signer_phone.trim() || companyPhone;
  const signerEmail = settings.signer_email.trim();

  return applyPdfVisibility(show, {
    companyName,
    companyAddress,
    companyPhone,
    companyLicense,
    logoUrl: normalizeLogoUrl(settings.logo_url.trim()),
    signerName,
    signerTitle: settings.signer_title.trim(),
    signerPhone,
    signerEmail,
  });
}

export function resolvePrintBranding(settings?: LetterheadSettings | null): PrintBranding {
  const merged = mergeSettings(
    settings ? normalizeLetterheadSettings(settings) : emptyLetterheadSettings(),
    envFallback(),
  );
  return letterheadToPrintBranding(merged);
}

function readLocalCache(): LetterheadSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeLetterheadSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalCache(settings: LetterheadSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota */
  }
}

export async function loadLetterheadSettings(userId: string): Promise<LetterheadSettings> {
  try {
    const effective = await loadRawUserSettings(userId);
    const normalized = normalizeLetterheadSettings(effective);
    writeLocalCache(normalized);
    return mergeSettings(normalized, envFallback());
  } catch (e) {
    console.warn("letterhead settings load failed, using cache/env:", e);
    return mergeSettings(readLocalCache() ?? emptyLetterheadSettings(), envFallback());
  }
}

export async function saveLetterheadSettings(
  userId: string,
  settings: LetterheadSettings,
  options?: { isAdmin?: boolean },
): Promise<string | null> {
  const normalized = normalizeLetterheadSettings(settings);
  writeLocalCache(normalized);

  const personalPatch: Record<string, unknown> = {
    signer_name: normalized.signer_name,
    signer_title: normalized.signer_title,
    signer_phone: normalized.signer_phone,
    signer_email: normalized.signer_email,
  };

  if (!options?.isAdmin) {
    personalPatch.pdf_show = {
      signer_name: normalized.pdf_show.signer_name,
      signer_title: normalized.pdf_show.signer_title,
      signer_phone: normalized.pdf_show.signer_phone,
      signer_email: normalized.pdf_show.signer_email,
    };
  }

  const personalErr = await patchUserSettings(userId, personalPatch);
  if (personalErr) return personalErr;

  if (!options?.isAdmin) return null;

  return patchOrgSettings(userId, {
    company_name: normalized.company_name,
    company_address: normalized.company_address,
    company_phone: normalized.company_phone,
    company_license: normalized.company_license,
    logo_url: normalized.logo_url,
    pdf_show: normalized.pdf_show,
  });
}

export async function uploadEmailSignatureLogo(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) ? ext : "png";
  const path = `${userId}/signature-logo.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("letterhead").upload(path, file, {
    upsert: true,
    contentType: file.type || `image/${safeExt}`,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("letterhead").getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not get logo URL after upload.");
  return data.publicUrl;
}

export async function uploadLetterheadLogo(
  userId: string,
  file: File,
  options?: { orgShared?: boolean },
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) ? ext : "png";
  const path = options?.orgShared ? `org/logo.${safeExt}` : `${userId}/logo.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("letterhead").upload(path, file, {
    upsert: true,
    contentType: file.type || `image/${safeExt}`,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("letterhead").getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not get logo URL after upload.");
  return data.publicUrl;
}
