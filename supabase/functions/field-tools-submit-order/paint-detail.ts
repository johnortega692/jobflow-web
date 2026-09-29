function foldVendor(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Legacy paint lines stored the vendor in detail ("Sherwin Williams · Semi-Gloss · color").
 * Sheen/Color should be sheen and color only. Newer lines already omit the vendor.
 */
export function sheenColorWithoutVendor(detail: string | undefined, vendor: string | undefined): string {
  const text = (detail ?? "").trim();
  const vendorName = (vendor ?? "").trim();
  if (!text || !vendorName) return text;
  const foldedVendor = foldVendor(vendorName);
  if (!foldedVendor) return text;

  for (const sep of [" · ", " — ", " - "]) {
    const idx = text.indexOf(sep);
    if (idx <= 0) continue;
    const head = text.slice(0, idx);
    if (foldVendor(head) !== foldedVendor) continue;
    return text.slice(idx + sep.length).trim();
  }
  return text;
}
