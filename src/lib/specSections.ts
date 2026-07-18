/** Org-level CSI / spec section list for submittals, SDS, and transmittals. */

import { loadRawUserSettings, patchOrgSettings, removeUserSettingsKeys } from "./budgetLibrary";

export const SPEC_SECTIONS_KEY = "spec_sections";

export const DEFAULT_PAINT_SPEC_SECTION = "09 91 23 - Interior Painting";
export const DEFAULT_WC_SPEC_SECTION = "09 72 00 - Wall Coverings";
export const DEFAULT_FRP_SPEC_SECTION = "06 60 00 - Plastic Fabrications (FRP)";

/** Built-in list used until Settings → Spec sections is customized. */
export const DEFAULT_SPEC_SECTIONS = [
  "09 51 00 - Acoustical Ceilings",
  "09 62 00 - Specialty Ceilings",
  "09 65 00 - Resilient Flooring",
  "09 67 00 - Fluid-Applied Flooring",
  "09 72 00 - Wall Coverings",
  "09 84 00 - Acoustical Treatment",
  "09 91 13 - Exterior Painting",
  "09 91 23 - Interior Painting",
  "09 96 00 - High-Performance Coatings",
  "09 97 00 - Special Coatings",
  "07 84 00 - Firestopping",
  "07 92 00 - Joint Sealants",
  "06 60 00 - Plastic Fabrications (FRP)",
  "06 20 00 - Finish Carpentry",
  "09 29 00 - Gypsum Board",
] as const;

let cachedSections: string[] | null = null;

export function normalizeSpecSections(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function defaultSpecSectionsList(): string[] {
  return [...DEFAULT_SPEC_SECTIONS];
}

export function clearSpecSectionsCache(): void {
  cachedSections = null;
}

export async function loadSpecSections(userId?: string | null): Promise<string[]> {
  if (cachedSections) return cachedSections;
  if (userId) {
    const raw = await loadRawUserSettings(userId);
    const custom = normalizeSpecSections(raw[SPEC_SECTIONS_KEY]);
    if (custom && custom.length) {
      cachedSections = custom;
      return custom;
    }
  }
  const defaults = defaultSpecSectionsList();
  cachedSections = defaults;
  return defaults;
}

export async function loadSpecSectionsSettingsDraft(userId: string): Promise<{
  sections: string[];
  usingCustom: boolean;
}> {
  const raw = await loadRawUserSettings(userId);
  const custom = normalizeSpecSections(raw[SPEC_SECTIONS_KEY]);
  if (custom && custom.length) {
    return { sections: custom, usingCustom: true };
  }
  return { sections: defaultSpecSectionsList(), usingCustom: false };
}

export async function saveSpecSections(userId: string, sections: string[]): Promise<string | null> {
  const next = normalizeSpecSections(sections) ?? [];
  const err = await patchOrgSettings(userId, { [SPEC_SECTIONS_KEY]: next });
  if (!err) {
    cachedSections = next.length ? next : defaultSpecSectionsList();
  }
  return err;
}

export async function resetSpecSectionsToDefaults(userId: string): Promise<string | null> {
  const err = await removeUserSettingsKeys(userId, [SPEC_SECTIONS_KEY]);
  if (!err) clearSpecSectionsCache();
  return err;
}

/** Ensure current value appears in the dropdown even if removed from settings. */
export function specSectionSelectOptions(sections: string[], current: string): string[] {
  const value = current.trim();
  if (!value) return sections;
  if (sections.includes(value)) return sections;
  return [value, ...sections];
}

/**
 * Display text for submittal banners: "Spec Section 09 91 23 – Interior Painting"
 * Accepts stored values like "09 91 23 - Interior Painting" or already-prefixed strings.
 */
export function formatSpecSectionBannerText(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/^Spec\s*Section\s*:?\s*/i, "").trim();
  if (!text) return "";
  text = text.replace(/\s*[-–—]\s*/, " – ");
  return `Spec Section ${text}`;
}
