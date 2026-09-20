export type ContactCardInput = {
  name: string;
  phone?: string;
  org?: string;
  note?: string;
};

function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function vcardNameParts(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ";;;;";
  if (parts.length === 1) return `${escapeVCardText(parts[0])};;;;`;
  const given = parts.slice(0, -1).join(" ");
  const family = parts[parts.length - 1] ?? "";
  return `${escapeVCardText(family)};${escapeVCardText(given)};;;`;
}

export function buildVCard(input: ContactCardInput): string {
  const name = input.name.trim() || input.phone?.trim() || "GC Super";
  const phoneDigits = (input.phone ?? "").replace(/[^\d+]/g, "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardText(name)}`,
    `N:${vcardNameParts(name)}`,
  ];
  if (input.org?.trim()) lines.push(`ORG:${escapeVCardText(input.org.trim())}`);
  if (phoneDigits) lines.push(`TEL;TYPE=CELL:${phoneDigits}`);
  if (input.note?.trim()) lines.push(`NOTE:${escapeVCardText(input.note.trim())}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function vcardFileName(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gc-super";
  return `${slug}.vcf`;
}

export function vcardHref(input: ContactCardInput): string {
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(input))}`;
}
