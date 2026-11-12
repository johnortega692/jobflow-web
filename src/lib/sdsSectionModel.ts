import type { SdsSection } from "../types/tradeDocuments.js";

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

/** Each type holds zero or more PDFs. Older packets stored one object, or sometimes a path string. */
export type SdsSectionAttachments = Partial<Record<SdsAttachmentKind, SdsFileAttachment[]>>;

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

type LegacyAttachmentValue = string | SdsFileAttachment | Array<string | SdsFileAttachment>;

type LegacyAttachmentBag = Partial<Record<SdsAttachmentKind, LegacyAttachmentValue>>;

type LegacySection = Partial<Omit<SdsSection, "attachments">> & {
  sheen_type?: string;
  material?: string;
  tds_path?: string;
  sds_path?: string;
  tds_filename?: string;
  sds_filename?: string;
  attachments?: LegacyAttachmentBag;
};

function fileFromUnknown(value: unknown): SdsFileAttachment | null {
  if (typeof value === "string") {
    const path = value.trim();
    if (!path) return null;
    const filename = path.split(/[/\\]/).pop() || path;
    return { path, filename };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const path = "path" in value && typeof value.path === "string" ? value.path.trim() : "";
  if (!path) return null;
  const filename = "filename" in value && typeof value.filename === "string" ? value.filename.trim() : "";
  return { path, filename };
}

function fileListFromUnknown(value: unknown): SdsFileAttachment[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const out: SdsFileAttachment[] = [];
  for (const item of items) {
    const file = fileFromUnknown(item);
    if (file) out.push(file);
  }
  return out;
}

export function normalizeSdsSection(raw: LegacySection | null | undefined): SdsSection {
  const base = emptySdsSectionInternal();
  if (!raw) return base;

  const legacy = raw.attachments;
  const attachments: SdsSectionAttachments = {};
  for (const { kind } of SDS_ATTACHMENT_KINDS) {
    const files = fileListFromUnknown(legacy?.[kind]);
    if (files.length) attachments[kind] = files;
  }
  if (raw.tds_path?.trim() && !attachments.product_data?.length) {
    attachments.product_data = [{ path: raw.tds_path.trim(), filename: raw.tds_filename?.trim() || "" }];
  }
  if (raw.sds_path?.trim() && !attachments.sds?.length) {
    attachments.sds = [{ path: raw.sds_path.trim(), filename: raw.sds_filename?.trim() || "" }];
  }

  const category = normalizeCategory(raw.category);

  const section: SdsSection = {
    id: raw.id?.trim() || base.id,
    category,
    spec_section: typeof raw.spec_section === "string" ? raw.spec_section.trim() : "",
    manufacturer: raw.manufacturer?.trim() ?? "",
    product: raw.product?.trim() ?? "",
    finish_type: sanitizeFinishType(raw.finish_type ?? raw.sheen_type ?? ""),
    system_material: (raw.system_material ?? raw.material ?? "").trim(),
    color: raw.color?.trim() ?? "",
    size: raw.size?.trim() ?? "",
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
    spec_section: "",
    manufacturer: "",
    product: "",
    finish_type: "",
    system_material: "",
    color: "",
    size: "",
    intended_use: "",
    attachments: {},
  };
}

/** Unique CSIs in first-seen order after sort-by-spec. */
export function uniqueSdsSpecSections(sections: SdsSection[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const section of sortSdsSectionsBySpec(sections)) {
    const value = section.spec_section.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Cover / notes label: joined unique CSIs, or empty. */
export function sdsPacketSpecSectionsLabel(sections: SdsSection[]): string {
  return uniqueSdsSpecSections(sections).join("; ");
}

/**
 * Filename CSI token: exactly one unique section CSI, otherwise blank
 * (never invent a lead when 0 or 2+).
 */
export function sdsPacketFilenameSpecSection(sections: SdsSection[]): string {
  const unique = uniqueSdsSpecSections(sections);
  return unique.length === 1 ? unique[0]! : "";
}

/** Sort by CSI (blank last), then category, then product — stable within ties. */
/** Groups by spec section, blank specs last. Order inside a spec is the user's drag order. */
export function sortSdsSectionsBySpec(sections: SdsSection[]): SdsSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const aSpec = a.section.spec_section.trim();
      const bSpec = b.section.spec_section.trim();
      const aBlank = !aSpec;
      const bBlank = !bSpec;
      if (aBlank !== bBlank) return aBlank ? 1 : -1;
      const specCmp = aSpec.localeCompare(bSpec, undefined, { sensitivity: "base" });
      if (specCmp !== 0) return specCmp;
      return a.index - b.index;
    })
    .map(({ section }) => section);
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

/** Files for one type, in attachment order. */
export function sectionAttachmentFiles(section: SdsSection, kind: SdsAttachmentKind): SdsFileAttachment[] {
  return (section.attachments[kind] ?? []).filter((file) => file.path?.trim());
}

export function sectionHasAttachment(section: SdsSection, kind: SdsAttachmentKind): boolean {
  return sectionAttachmentFiles(section, kind).length > 0;
}

export function sectionAttachmentCount(section: SdsSection): number {
  return SDS_ATTACHMENT_KINDS.reduce((total, kind) => total + sectionAttachmentFiles(section, kind.kind).length, 0);
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

export const SELF_PRIMING_NOTE = "Self-priming";

export function intendedUseHasSelfPriming(notes: string): boolean {
  return notes
    .split(";")
    .some((part) => part.trim().toLowerCase() === SELF_PRIMING_NOTE.toLowerCase());
}

export function setSelfPrimingNote(notes: string, on: boolean): string {
  const parts = notes
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== SELF_PRIMING_NOTE.toLowerCase());
  if (on) parts.push(SELF_PRIMING_NOTE);
  return parts.join("; ");
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
  return sectionAttachmentCount(section);
}

function attachmentFileStem(file: SdsFileAttachment): string {
  const stem = file.filename.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim();
  return stem.length > 72 ? `${stem.slice(0, 71)}…` : stem;
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

export type IncludedSectionDocument = {
  kind: SdsAttachmentKind;
  fileIndex: number;
  /** Divider line. A second SDS uses its file name so Part A and Part B stay distinct. */
  label: string;
  tocLabel: string;
  stamp: string;
};

export function sectionIncludedDocuments(section: SdsSection): IncludedSectionDocument[] {
  const docs: IncludedSectionDocument[] = [];
  for (const kind of sectionAttachmentKinds(section)) {
    const files = sectionAttachmentFiles(section, kind);
    files.forEach((file, fileIndex) => {
      const single = files.length === 1;
      const stem = attachmentFileStem(file);
      const base = dividerDocumentLabel(kind);
      const toc = tocAttachmentLabel(kind);
      docs.push({
        kind,
        fileIndex,
        label: single || !stem ? (single ? base : `${base} ${fileIndex + 1}`) : stem,
        tocLabel: single || !stem ? (single ? toc : `${toc} ${fileIndex + 1}`) : stem,
        stamp: single ? attachmentStampLabel(kind) : `${attachmentStampLabel(kind)} ${fileIndex + 1}`,
      });
    });
  }
  return docs;
}

export function tocSectionTitle(section: SdsSection): string {
  const mfr = section.manufacturer.trim();
  const product = section.product.trim();
  const finish = section.finish_type.trim();
  const name = [mfr, product].filter(Boolean).join(" ");
  if (!name) return finish || "Product Section";
  return finish ? `${name} ${finish}` : name;
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
