import type { SdsSection } from "../types/tradeDocuments";

export type SdsSectionCategory =
  | "Paint"
  | "Wallcovering"
  | "FRP"
  | "Acoustical Panels"
  | "Fabric Wrapped Panels"
  | "Fireproofing"
  | "Sealants"
  | "Flooring"
  | "Ceiling"
  | "Misc Finish";

export const SDS_SECTION_CATEGORIES: SdsSectionCategory[] = [
  "Paint",
  "Wallcovering",
  "FRP",
  "Acoustical Panels",
  "Fabric Wrapped Panels",
  "Fireproofing",
  "Sealants",
  "Flooring",
  "Ceiling",
  "Misc Finish",
];

export type SdsAttachmentKind =
  | "product_data"
  | "sds"
  | "warranty"
  | "leed_hpd"
  | "test_report"
  | "maintenance";

export type SdsFileAttachment = {
  path: string;
  filename: string;
};

export type SdsSectionAttachments = Partial<Record<SdsAttachmentKind, SdsFileAttachment>>;

export const SDS_ATTACHMENT_KINDS: {
  kind: SdsAttachmentKind;
  label: string;
  short: string;
  stamp: string;
}[] = [
  { kind: "product_data", label: "Product Data / TDS", short: "TDS", stamp: "Product Data / TDS" },
  { kind: "sds", label: "SDS", short: "SDS", stamp: "SDS" },
  { kind: "warranty", label: "Warranty", short: "Warranty", stamp: "Warranty" },
  { kind: "leed_hpd", label: "LEED / HPD / EPD", short: "LEED", stamp: "LEED / HPD / EPD" },
  { kind: "test_report", label: "Test Report", short: "Test", stamp: "Test Report" },
  { kind: "maintenance", label: "Maintenance Data", short: "Maint", stamp: "Maintenance" },
];

type LegacySection = Partial<SdsSection> & {
  sheen_type?: string;
  material?: string;
  tds_path?: string;
  sds_path?: string;
  tds_filename?: string;
  sds_filename?: string;
};

export function normalizeSdsSection(raw: LegacySection | null | undefined): SdsSection {
  const base = emptySdsSectionInternal();
  if (!raw) return base;

  const attachments: SdsSectionAttachments = { ...(raw.attachments ?? {}) };
  if (raw.tds_path?.trim() && !attachments.product_data) {
    attachments.product_data = { path: raw.tds_path.trim(), filename: raw.tds_filename?.trim() || "" };
  }
  if (raw.sds_path?.trim() && !attachments.sds) {
    attachments.sds = { path: raw.sds_path.trim(), filename: raw.sds_filename?.trim() || "" };
  }

  const category = normalizeCategory(raw.category);

  const section: SdsSection = {
    id: raw.id?.trim() || base.id,
    category,
    manufacturer: raw.manufacturer?.trim() ?? "",
    product: raw.product?.trim() ?? "",
    finish_type: sanitizeFinishType(raw.finish_type ?? raw.sheen_type ?? ""),
    system_material: (raw.system_material ?? raw.material ?? "").trim(),
    color: raw.color?.trim() ?? "",
    intended_use: raw.intended_use?.trim() ?? "",
    attachments,
  };

  return {
    ...section,
    intended_use: normalizeStoredIntendedUse(section),
  };
}

function normalizeStoredIntendedUse(section: SdsSection): string {
  const intended = section.intended_use.trim();
  if (!intended) return "";

  const suffix = attachmentIncludeSuffix(section);
  if (isAutoIncludeNote(intended, suffix)) return "";

  const parts = intended
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const customParts = [...new Set(parts.filter((part) => !isAutoIncludeNote(part, suffix)))];
  return customParts.join("; ");
}

function emptySdsSectionInternal(): SdsSection {
  return {
    id: crypto.randomUUID(),
    category: "Paint",
    manufacturer: "",
    product: "",
    finish_type: "",
    system_material: "",
    color: "",
    intended_use: "",
    attachments: {},
  };
}

const LEGACY_CATEGORY_MAP: Record<string, SdsSectionCategory> = {
  "Panel System": "Misc Finish",
  Drywall: "Misc Finish",
};

const ATTACHMENT_FILENAME_TOKENS = new Set([
  "sds",
  "tds",
  "pds",
  "warranty",
  "wty",
  "leed",
  "hpd",
  "epd",
  "test",
  "test report",
  "maintenance",
  "maint",
  "o&m",
  "om",
  "product data",
  "pds/tds",
  "product data / tds",
  "leed/hpd",
  "leed / hpd / epd",
]);

/** Strip trailing attachment tokens (e.g. "Eggshell - SDS" → "Eggshell"). */
export function sanitizeFinishType(value: string): string {
  const parts = value
    .trim()
    .split(/\s*[-_|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  while (parts.length > 0 && isAttachmentFilenameToken(parts[parts.length - 1]!)) {
    parts.pop();
  }
  return parts.join(" - ");
}

function isAttachmentFilenameToken(part: string): boolean {
  const norm = part.toLowerCase().replace(/\s+/g, " ");
  return ATTACHMENT_FILENAME_TOKENS.has(norm);
}

function normalizeCategory(value: string | undefined): SdsSectionCategory {
  const v = (value ?? "").trim();
  if (SDS_SECTION_CATEGORIES.includes(v as SdsSectionCategory)) {
    return v as SdsSectionCategory;
  }
  if (LEGACY_CATEGORY_MAP[v]) return LEGACY_CATEGORY_MAP[v];
  return "Misc Finish";
}

export function sectionHasAttachment(section: SdsSection, kind: SdsAttachmentKind): boolean {
  return Boolean(section.attachments[kind]?.path?.trim());
}

export function sectionAttachmentCount(section: SdsSection): number {
  return SDS_ATTACHMENT_KINDS.filter((k) => sectionHasAttachment(section, k.kind)).length;
}

export function sectionHasAnyAttachment(section: SdsSection): boolean {
  return sectionAttachmentCount(section) > 0;
}

export function attachmentSummary(section: SdsSection): string {
  const parts = SDS_ATTACHMENT_KINDS.filter((k) => sectionHasAttachment(section, k.kind)).map(
    (k) => k.short,
  );
  return parts.length ? parts.join(" · ") : "—";
}

export function attachmentIncludeSuffix(section: SdsSection): string {
  const labels = SDS_ATTACHMENT_KINDS.filter((k) => sectionHasAttachment(section, k.kind)).map(
    (k) => k.label,
  );
  return labels.length ? `Include ${labels.join(", ")}` : "";
}

const LEGACY_AUTO_INCLUDE_NOTES = new Set([
  "Include TDS",
  "Include SDS",
  "Include TDS and SDS",
  "Include Product Data (PDS/TDS)",
  "Include Product Data / TDS",
  "Include LEED/HPD",
  "Include LEED / HPD / EPD",
  ...SDS_ATTACHMENT_KINDS.map((k) => `Include ${k.label}`),
]);

/** True when notes are auto-generated from attachment rows (not custom user text). */
export function isAutoIncludeNote(text: string, currentSuffix = ""): boolean {
  const t = text.trim();
  if (!t) return false;
  if (LEGACY_AUTO_INCLUDE_NOTES.has(t)) return true;
  if (currentSuffix && t === currentSuffix) return true;
  if (!t.startsWith("Include ")) return false;
  const body = t.slice("Include ".length);
  const parts = body
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((part) => SDS_ATTACHMENT_KINDS.some((k) => k.label === part));
}

export function notesFromAttachments(section: SdsSection): string {
  const suffix = attachmentIncludeSuffix(section);
  const intended = section.intended_use.trim();

  if (!intended) return suffix || "—";

  const parts = intended
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const uniqueParts = [...new Set(parts)];

  if (uniqueParts.length > 1 && uniqueParts.every((part) => isAutoIncludeNote(part, suffix))) {
    return suffix || uniqueParts[0]!;
  }

  if (uniqueParts.length === 1) {
    const only = uniqueParts[0]!;
    if (isAutoIncludeNote(only, suffix)) return suffix || only;
    return only;
  }

  const customParts = uniqueParts.filter((part) => !isAutoIncludeNote(part, suffix));
  if (customParts.length) return customParts.join("; ");

  return suffix || intended;
}

export function sectionsGroupedByCategory(sections: SdsSection[]): SdsSection[] {
  const buckets = new Map<SdsSectionCategory, SdsSection[]>();
  for (const cat of SDS_SECTION_CATEGORIES) buckets.set(cat, []);
  for (const section of sections) {
    const cat = normalizeCategory(section.category);
    buckets.get(cat)!.push(section);
  }
  return SDS_SECTION_CATEGORIES.flatMap((cat) => buckets.get(cat) ?? []);
}

export function attachmentStampLabel(kind: SdsAttachmentKind): string {
  return SDS_ATTACHMENT_KINDS.find((k) => k.kind === kind)?.stamp ?? kind;
}

/** Ordered attachment kinds present on a section (for PDF assembly). */
export function sectionAttachmentKinds(section: SdsSection): SdsAttachmentKind[] {
  return SDS_ATTACHMENT_KINDS.filter((k) => sectionHasAttachment(section, k.kind)).map((k) => k.kind);
}

export function countSectionPdfPages(section: SdsSection): number {
  return sectionAttachmentKinds(section).length;
}

export const SDS_DIVIDER_DOCUMENT_LABELS: Record<SdsAttachmentKind, string> = {
  product_data: "Product Data Sheet",
  sds: "Safety Data Sheet",
  warranty: "Warranty",
  leed_hpd: "LEED / HPD / EPD",
  test_report: "Test Report",
  maintenance: "Maintenance Data",
};

export function dividerDocumentLabel(kind: SdsAttachmentKind): string {
  return SDS_DIVIDER_DOCUMENT_LABELS[kind];
}

export function sectionIncludedDocuments(
  section: SdsSection,
): { kind: SdsAttachmentKind; label: string }[] {
  return sectionAttachmentKinds(section).map((kind) => ({
    kind,
    label: dividerDocumentLabel(kind),
  }));
}

export function tocSectionTitle(section: SdsSection): string {
  const mfr = section.manufacturer.trim();
  const product = section.product.trim();
  if (mfr && product) return `${mfr} ${product}`;
  return product || mfr || "Product Section";
}

const TOC_ATTACHMENT_LABELS: Record<SdsAttachmentKind, string> = {
  product_data: "Product Data",
  sds: "SDS",
  warranty: "Warranty",
  leed_hpd: "LEED / HPD / EPD",
  test_report: "Test Report",
  maintenance: "Maintenance Data",
};

export function tocAttachmentLabel(kind: SdsAttachmentKind): string {
  return TOC_ATTACHMENT_LABELS[kind];
}

export function packetProductCount(sections: SdsSection[]): number {
  return sections.length;
}

export function packetDocumentCount(sections: SdsSection[]): number {
  return sections.reduce((total, section) => total + sectionAttachmentCount(section), 0);
}
