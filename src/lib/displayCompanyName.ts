export const IRONWOOD_FULL_COMPANY_NAME = "Ironwood Commercial Builders";
export const IRONWOOD_SHORT_COMPANY_NAME = "ICBI";

/** Full name fits at 28 chars; use ICBI when longer or in tight layouts (lower maxLength). */
export function resolveDisplayCompanyName(raw: string, maxLength = 29): string {
  const trimmed = raw.trim();
  let name =
    !trimmed || /^ironwood$/i.test(trimmed) ? IRONWOOD_FULL_COMPANY_NAME : trimmed;
  if (name.length > maxLength) return IRONWOOD_SHORT_COMPANY_NAME;
  return name;
}
