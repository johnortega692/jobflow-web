import type { Json } from "../types/database";
import { supabase } from "./supabase";
import { loadRawUserSettings } from "./budgetLibrary";
import {
  emptyLetterheadSettings,
  normalizeLetterheadSettings,
  type LetterheadSettings,
} from "../types/letterheadSettings";
import type { PrintBranding } from "./printCore";
import { buildCompanyContactLine } from "./printCore";

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
  const pick = (key: keyof LetterheadSettings) => saved[key] || env[key] || "";
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
  };
}

export function letterheadToPrintBranding(settings: LetterheadSettings): PrintBranding {
  const companyName = settings.company_name.trim() || "Plan B Apps";
  const companyAddress = settings.company_address.trim();
  const companyPhone = settings.company_phone.trim();
  const companyLicense = settings.company_license.trim();
  const signerName = settings.signer_name.trim() || companyName;
  const signerPhone = settings.signer_phone.trim() || companyPhone;
  const signerEmail = settings.signer_email.trim();
  const companyContactLine = buildCompanyContactLine(companyAddress, companyPhone, companyLicense);
  const fromBlock = [companyName, companyAddress].filter(Boolean).join("\n");

  return {
    companyName,
    companyAddress,
    companyPhone,
    companyLicense,
    companyInfo: companyContactLine,
    companyContactLine,
    logoUrl: settings.logo_url.trim(),
    logoAlt: companyName,
    footerName: signerName,
    footerPhone: signerPhone,
    footerEmail: signerEmail,
    fromBlock,
    fromPhone: signerPhone,
    signerName,
    signerTitle: settings.signer_title.trim(),
    signerPhone,
    signerEmail,
  };
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
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("user_settings load failed, using cache/env:", error.message);
    return mergeSettings(readLocalCache() ?? emptyLetterheadSettings(), envFallback());
  }

  if (!data?.settings) {
    return mergeSettings(emptyLetterheadSettings(), envFallback());
  }

  const normalized = normalizeLetterheadSettings(data.settings);
  writeLocalCache(normalized);
  return mergeSettings(normalized, envFallback());
}

export async function saveLetterheadSettings(
  userId: string,
  settings: LetterheadSettings,
): Promise<string | null> {
  const normalized = normalizeLetterheadSettings(settings);
  writeLocalCache(normalized);

  const current = await loadRawUserSettings(userId);
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      settings: { ...current, ...normalized } as Json,
    },
    { onConflict: "user_id" },
  );

  return error?.message ?? null;
}

export async function uploadLetterheadLogo(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) ? ext : "png";
  const path = `${userId}/logo.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("letterhead").upload(path, file, {
    upsert: true,
    contentType: file.type || `image/${safeExt}`,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("letterhead").getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Could not get logo URL after upload.");
  return data.publicUrl;
}
