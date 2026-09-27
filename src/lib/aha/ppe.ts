export const AHA_STANDARD_PPE_KEY = "aha_standard_ppe";

export const DEFAULT_STANDARD_PPE = [
  "Hard hat",
  "Safety glasses",
  "Cut-resistant gloves",
  "Hi-vis vest",
  "Work boots",
];

export function parseStandardPpe(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_STANDARD_PPE];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export function ppeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Company standard first, then this AHA's additions. Duplicates collapse. */
export function combinedPpe(standard: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...standard, ...extra]) {
    const trimmed = item.trim();
    const key = ppeKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
