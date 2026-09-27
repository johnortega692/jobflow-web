/** "{street}, {City}, {ST} {ZIP}". Blank city/state/zip falls back to a single extra line. */
export function formatAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  fallbackLine?: string | null;
}): string {
  const street = (parts.street ?? "").trim();
  const city = (parts.city ?? "").trim();
  const state = (parts.state ?? "").trim();
  const zip = (parts.zip ?? "").trim();
  if (!city && !state && !zip) {
    return [street, (parts.fallbackLine ?? "").trim()].filter(Boolean).join(", ");
  }
  const stateZip = [state, zip].filter(Boolean).join(" ");
  const locality = [city, stateZip].filter(Boolean).join(", ");
  return [street, locality].filter(Boolean).join(", ");
}
