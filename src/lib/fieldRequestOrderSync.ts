import { googleSheetsGet } from "./googleSheetsApi";

export type FieldRequestStaffLists = {
  pms: string[];
  supers: string[];
};

/** Field Request Order web app — PM/Super staff lists for job setup. */
export function fieldRequestOrderUrl(urls: Record<string, string>): string {
  return (urls.field_request_order || urls.brushouts_tracker || "").trim();
}

/** @deprecated Staff lists now load from Settings → Project staff (Supabase org settings). */
export async function fetchFieldRequestStaffLists(
  webAppUrl: string | undefined,
): Promise<{ lists: FieldRequestStaffLists; error: string | null }> {
  const url = webAppUrl?.trim();
  if (!url) {
    return { lists: { pms: [], supers: [] }, error: "Field Request Order URL not configured in Settings." };
  }
  try {
    const { status, json } = await googleSheetsGet(url, { action: "getStaffLists" });
    if (status !== 200) {
      return { lists: { pms: [], supers: [] }, error: `Could not load PM/Super lists (${status}).` };
    }
    const data = json as { success?: boolean; pms?: unknown; supers?: unknown; error?: string };
    if (data.success === false) {
      return { lists: { pms: [], supers: [] }, error: data.error ?? "Staff list request failed." };
    }
    const pms = Array.isArray(data.pms)
      ? data.pms.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const supers = Array.isArray(data.supers)
      ? data.supers.map((v) => String(v).trim()).filter(Boolean)
      : [];
    return { lists: { pms, supers }, error: null };
  } catch (e) {
    return {
      lists: { pms: [], supers: [] },
      error: e instanceof Error ? e.message : "Could not load PM/Super lists.",
    };
  }
}
