export type SdsPacketType =
  | "SDS & TDS"
  | "Product Data"
  | "Finish Submittal"
  | "Shop Drawings"
  | "LEED / Sustainability"
  | "Test Reports"
  | "Warranty Package"
  | "O&M Manual"
  | "Closeout Package"
  | "Custom";

export const SDS_PACKET_TYPES: SdsPacketType[] = [
  "SDS & TDS",
  "Product Data",
  "Finish Submittal",
  "Shop Drawings",
  "LEED / Sustainability",
  "Test Reports",
  "Warranty Package",
  "O&M Manual",
  "Closeout Package",
  "Custom",
];

type SdsPacketPreset = {
  coverTitle: string;
  defaultPurpose: string;
  outputSlug: string;
};

const SDS_PACKET_PRESETS: Record<SdsPacketType, SdsPacketPreset> = {
  "SDS & TDS": {
    coverTitle: "SDS & TDS SUBMITTAL",
    defaultPurpose:
      "Safety Data Sheets and Technical Data Sheets are submitted for review and project records.",
    outputSlug: "SDS_TDS",
  },
  "Product Data": {
    coverTitle: "PRODUCT DATA SUBMITTAL",
    defaultPurpose:
      "Product data and technical data sheets are submitted for review and approval prior to procurement and installation.",
    outputSlug: "Product_Data",
  },
  "Finish Submittal": {
    coverTitle: "FINISH SUBMITTAL",
    defaultPurpose:
      "Finish materials and supporting documentation are submitted for review and approval.",
    outputSlug: "Finish_Submittal",
  },
  "Shop Drawings": {
    coverTitle: "SHOP DRAWING SUBMITTAL",
    defaultPurpose:
      "Shop drawings are submitted for review and coordination with project requirements.",
    outputSlug: "Shop_Drawings",
  },
  "LEED / Sustainability": {
    coverTitle: "SUSTAINABILITY DOCUMENTATION",
    defaultPurpose:
      "LEED, HPD, EPD, and related sustainability documentation are submitted for project compliance.",
    outputSlug: "LEED_Sustainability",
  },
  "Test Reports": {
    coverTitle: "TEST REPORT SUBMITTAL",
    defaultPurpose:
      "Test reports and supporting documentation are submitted for review and record purposes.",
    outputSlug: "Test_Reports",
  },
  "Warranty Package": {
    coverTitle: "WARRANTY PACKAGE",
    defaultPurpose: "Warranty documentation is submitted in accordance with project requirements.",
    outputSlug: "Warranty_Package",
  },
  "O&M Manual": {
    coverTitle: "OPERATION & MAINTENANCE MANUAL",
    defaultPurpose:
      "Operation, maintenance, and product information are provided for project closeout.",
    outputSlug: "OM_Manual",
  },
  "Closeout Package": {
    coverTitle: "CLOSEOUT DOCUMENT PACKAGE",
    defaultPurpose: "Closeout documentation is submitted in accordance with contract requirements.",
    outputSlug: "Closeout_Package",
  },
  Custom: {
    coverTitle: "CUSTOM PACKAGE",
    defaultPurpose: "",
    outputSlug: "Custom",
  },
};

/** Older paint-focused defaults and prior preset wording — treated as editable presets on type change. */
const LEGACY_COVER_PURPOSES = new Set([
  "Safety Data Sheets for paint materials scheduled for use on this project.",
  "Technical Data Sheets for paint materials scheduled for use on this project.",
  "Safety Data Sheets and Technical Data Sheets for paint materials scheduled for use on this project.",
  "Safety Data Sheets and Technical Data Sheets for materials scheduled for use on this project.",
  "Product data and technical data sheets for materials scheduled for use on this project.",
  "Finish schedule and material information submitted for review and approval.",
  "Shop drawings submitted for review, coordination, and approval.",
  "LEED, HPD, EPD, and other sustainability documentation for materials on this project.",
  "Test reports and laboratory data submitted for review and project records.",
  "Manufacturer warranties submitted for review and closeout records.",
  "Operation and maintenance manuals submitted for review and closeout records.",
  "Closeout documentation including warranties, O&M data, and maintenance information.",
]);

function allPresetCoverPurposes(): Set<string> {
  const known = new Set<string>(LEGACY_COVER_PURPOSES);
  for (const type of SDS_PACKET_TYPES) {
    const purpose = SDS_PACKET_PRESETS[type].defaultPurpose.trim();
    if (purpose) known.add(purpose);
  }
  return known;
}

const PRESET_COVER_PURPOSES = allPresetCoverPurposes();

const LEGACY_PACKET_TYPE_MAP: Record<string, SdsPacketType> = {
  "Safety Data Sheets": "SDS & TDS",
  "Technical Data Sheets": "Product Data",
};

export function normalizePacketType(value: string | undefined): SdsPacketType {
  const v = (value ?? "").trim();
  if (SDS_PACKET_TYPES.includes(v as SdsPacketType)) return v as SdsPacketType;
  if (LEGACY_PACKET_TYPE_MAP[v]) return LEGACY_PACKET_TYPE_MAP[v];
  return "SDS & TDS";
}

export function defaultCoverPurpose(packetType: SdsPacketType): string {
  return SDS_PACKET_PRESETS[packetType].defaultPurpose;
}

/** True when purpose is empty or still a known preset (current or legacy) — safe to replace on type change. */
export function isPresetCoverPurpose(_packetType: SdsPacketType, purpose: string): boolean {
  const text = purpose.trim();
  if (!text) return true;
  return PRESET_COVER_PURPOSES.has(text);
}

export function resolveCoverPurpose(packetType: SdsPacketType, coverPurpose: string): string {
  const text = coverPurpose.trim();
  if (text) return text;
  return defaultCoverPurpose(packetType);
}

export function coverMainTitle(packetType: SdsPacketType): string {
  return SDS_PACKET_PRESETS[packetType].coverTitle;
}

export function resolveCoverTitle(packetType: SdsPacketType, coverTitle: string): string {
  if (packetType === "Custom") {
    return (coverTitle.trim() || coverMainTitle(packetType)).toUpperCase();
  }
  return coverMainTitle(packetType);
}

export function packetHeaderLine(packetType: SdsPacketType, coverTitle: string): string {
  if (packetType === "Custom") {
    const label = coverTitle.trim() || "Custom Submittal";
    return label.length > 48 ? `${label.slice(0, 47)}…` : label;
  }
  return packetType;
}

export function packetEndPageLabel(packetType: SdsPacketType, coverTitle: string): string {
  if (packetType === "Custom") return coverTitle.trim() || "Custom";
  return packetType;
}

export function packetOutputSlug(packetType: SdsPacketType, coverTitle: string): string {
  if (packetType === "Custom") {
    const slug = sanitizeFilenamePart(coverTitle.trim() || "Custom").slice(0, 40);
    return slug || "Custom";
  }
  return SDS_PACKET_PRESETS[packetType].outputSlug;
}

/** CSI-style section number for filenames, e.g. 09 72 00 → 097200 */
export function specSlugFromSection(specSection: string): string {
  const m = specSection.trim().match(/(\d{2})\s+(\d{2})\s+(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const compact = specSection.replace(/\s/g, "");
  if (/^\d{6}$/.test(compact)) return compact;
  return "Submittal";
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function specFilenamePart(specSection: string): string | null {
  const spec = specSection.trim();
  if (!spec) return null;
  const slug = specSlugFromSection(spec);
  if (slug !== "Submittal") return slug;
  const sanitized = sanitizeFilenamePart(spec);
  return sanitized || null;
}

export function packetPackageNumber(submittalNumber: number): string {
  const n = Number.isFinite(submittalNumber) && submittalNumber > 0 ? Math.floor(submittalNumber) : 1;
  return String(n).padStart(3, "0");
}

/** Keep spaces/dashes; strip OS-illegal filename characters. */
function sanitizeCompanyFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Company format: `{Submittal #} - {Spec Section #} - {Spec Name}.pdf`
 * e.g. `003 - 09 91 23 - Interior Painting.pdf`
 */
export function companySpecSubmittalFilename(
  submittalNumber: number,
  specSection: string,
): string {
  const num = packetPackageNumber(submittalNumber);
  const raw = specSection.trim().replace(/^Spec\s*Section\s*:?\s*/i, "");
  const split = raw.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  const code = sanitizeCompanyFilenamePart(split?.[1] ?? "");
  const name = sanitizeCompanyFilenamePart(split?.[2] ?? (split ? "" : raw));

  if (code && name) return `${num} - ${code} - ${name}.pdf`;
  if (code) return `${num} - ${code}.pdf`;
  if (name) return `${num} - ${name}.pdf`;
  return `${num} - Submittal.pdf`;
}

export function sdsPacketFilename(
  jobName: string,
  jobNumber: string,
  packet: {
    packet_type: SdsPacketType;
    cover_title: string;
    spec_section?: string;
    submittal_number: number;
    sections?: { spec_section?: string }[];
  },
): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const row of packet.sections ?? []) {
    const value = row.spec_section?.trim() ?? "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  // Exactly one CSI → include; 0 or 2+ → blank (no fake lead).
  const specForName =
    unique.length === 1 ? unique[0]! : unique.length === 0 ? (packet.spec_section?.trim() ?? "") : "";
  const base = companySpecSubmittalFilename(packet.submittal_number, specForName);
  const jobNo = sanitizeCompanyFilenamePart(jobNumber);
  const jobNm = sanitizeCompanyFilenamePart(jobName);
  const prefix = [jobNo, jobNm].filter(Boolean).join(" - ");
  return prefix ? `${prefix} - ${base}` : base;
}

/** Submittal log type mirrors the selected package preset. */
export function logSubmittalTypeForPacket(packetType: SdsPacketType): string {
  return packetType;
}
