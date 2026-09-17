const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Common mistypes of `.com` / similar — still a "valid" address, but mail will bounce. */
const SUSPICIOUS_TLDS = new Set([
  "ocm",
  "cmo",
  "con",
  "comm",
  "coom",
  "comn",
  "cpm",
  "vom",
  "xom",
  "cm",
  "om",
]);

/**
 * Non-blocking hint when an address is empty-shape invalid or a likely typo.
 * Returns null when the field is empty or looks fine. Never rewrites the value.
 */
export function emailAddressWarning(raw: string): string | null {
  const email = raw.trim();
  if (!email) return null;
  if (/\s/.test(email) || email.split("@").length !== 2) {
    return "This doesn't look like an email address. Mail may fail until it's corrected.";
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  if (!domain.includes(".") || tld.length < 2) {
    return "This email is missing a domain ending like .com. Mail may bounce.";
  }
  if (!EMAIL_SHAPE.test(email)) {
    return "This email format looks off. Mail may bounce until it's corrected.";
  }
  if (SUSPICIOUS_TLDS.has(tld)) {
    return `The ending ".${tld}" looks like a typo. Check the address so mail reaches the inbox.`;
  }
  return null;
}

/** Same check for a single address or a comma/semicolon-separated list. */
export function emailListWarning(raw: string): string | null {
  const parts = raw
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return emailAddressWarning(parts[0]!);
  for (const part of parts) {
    const warning = emailAddressWarning(part);
    if (warning) return `${part} — ${warning}`;
  }
  return null;
}
