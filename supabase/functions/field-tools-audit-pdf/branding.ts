import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { PDFDocument, PDFImage } from "https://esm.sh/pdf-lib@1.17.1";
import { resolveDisplayCompanyName } from "../displayCompanyName.ts";

export type OrderBranding = {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  logoUrl: string;
};

export async function loadOrderBranding(
  supabase: SupabaseClient,
  fallbackCompanyName: string,
): Promise<OrderBranding> {
  const envLogo = Deno.env.get("COMPANY_LOGO_URL")?.trim() ?? "";
  const { data } = await supabase.from("org_settings").select("settings").eq("id", 1).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;

  const rawName = String(settings.company_name ?? fallbackCompanyName).trim() || fallbackCompanyName;

  return {
    companyName: resolveDisplayCompanyName(rawName),
    companyAddress: String(settings.company_address ?? "").trim(),
    companyPhone: String(settings.company_phone ?? "").trim(),
    logoUrl: String(settings.logo_url ?? envLogo).trim(),
  };
}

export async function embedLogoImage(doc: PDFDocument, logoUrl: string): Promise<PDFImage | null> {
  const url = logoUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("png") || url.toLowerCase().includes(".png")) return doc.embedPng(bytes);
    if (type.includes("jpeg") || type.includes("jpg") || /\.jpe?g/i.test(url)) return doc.embedJpg(bytes);
    return doc.embedPng(bytes);
  } catch {
    return null;
  }
}
