import type { SdsPacketType } from "./sdsPacketPresets";
import {
  SDS_ATTACHMENT_KINDS,
  sectionHasAttachment,
  type SdsAttachmentKind,
} from "./sdsSectionModel";
import type { SdsSection } from "../types/tradeDocuments";

/** Attachment kinds required for every section under a packet type. */
export function requiredAttachmentsForPacketType(packetType: SdsPacketType): SdsAttachmentKind[] {
  switch (packetType) {
    case "SDS & TDS":
    case "Product Data":
    case "Finish Submittal":
    case "Custom":
      return ["product_data", "sds"];
    case "Shop Drawings":
      return [];
    case "LEED / Sustainability":
      return ["leed_hpd"];
    case "Test Reports":
      return ["test_report"];
    case "Warranty Package":
      return ["warranty"];
    case "O&M Manual":
      return ["maintenance"];
    case "Closeout Package":
      return ["product_data", "sds", "warranty", "maintenance"];
    default:
      return ["product_data", "sds"];
  }
}

export function attachmentShortLabel(kind: SdsAttachmentKind): string {
  return SDS_ATTACHMENT_KINDS.find((k) => k.kind === kind)?.short ?? kind;
}

export type AttachmentBadgeState =
  | { kind: SdsAttachmentKind; state: "attached"; label: string }
  | { kind: SdsAttachmentKind; state: "missing_required"; label: string };

/** Attached = quiet badge; required-missing = warn; optional-missing = omitted. */
export function sectionAttachmentBadges(
  section: SdsSection,
  packetType: SdsPacketType,
): AttachmentBadgeState[] {
  const required = new Set(requiredAttachmentsForPacketType(packetType));
  const badges: AttachmentBadgeState[] = [];

  for (const meta of SDS_ATTACHMENT_KINDS) {
    const has = sectionHasAttachment(section, meta.kind);
    if (has) {
      badges.push({ kind: meta.kind, state: "attached", label: meta.short });
      continue;
    }
    if (required.has(meta.kind)) {
      badges.push({
        kind: meta.kind,
        state: "missing_required",
        label: `No ${meta.short}`,
      });
    }
  }

  return badges;
}

export type SectionGap = {
  index: number;
  missingLabels: string[];
};

export type PacketReadiness = {
  sectionCount: number;
  gaps: SectionGap[];
  /** Counts of required-missing attachments across sections, keyed by short label. */
  missingCounts: { label: string; count: number }[];
  ready: boolean;
  summaryLine: string;
  confirmMessage: string;
};

export function evaluatePacketReadiness(
  sections: SdsSection[],
  packetType: SdsPacketType,
): PacketReadiness {
  const required = requiredAttachmentsForPacketType(packetType);
  const gaps: SectionGap[] = [];
  const countByKind = new Map<SdsAttachmentKind, number>();

  sections.forEach((section, i) => {
    const missing = required.filter((kind) => !sectionHasAttachment(section, kind));
    if (!missing.length) return;
    gaps.push({
      index: i + 1,
      missingLabels: missing.map(attachmentShortLabel),
    });
    for (const kind of missing) {
      countByKind.set(kind, (countByKind.get(kind) ?? 0) + 1);
    }
  });

  const missingCounts = SDS_ATTACHMENT_KINDS.filter((k) => countByKind.has(k.kind)).map((k) => ({
    label: k.short,
    count: countByKind.get(k.kind)!,
  }));

  const sectionCount = sections.length;
  const sectionLabel = sectionCount === 1 ? "1 section" : `${sectionCount} sections`;
  let summaryLine: string;
  if (!sectionCount) {
    summaryLine = "0 sections";
  } else if (!gaps.length) {
    summaryLine = `${sectionLabel} · ready`;
  } else {
    const parts = missingCounts.map(({ label, count }) =>
      count === 1 ? `1 missing ${label}` : `${count} missing ${label}`,
    );
    summaryLine = `${sectionLabel} · ${parts.join(", ")}`;
  }

  const confirmLines = gaps.map((gap) => {
    if (gap.missingLabels.length === 1) {
      return `Section ${gap.index} has no ${gap.missingLabels[0]} attached.`;
    }
    return `Section ${gap.index} is missing ${gap.missingLabels.join(", ")}.`;
  });
  const confirmMessage = `${confirmLines.join("\n")}\n\nGenerate anyway?`;

  return {
    sectionCount,
    gaps,
    missingCounts,
    ready: sectionCount > 0 && gaps.length === 0,
    summaryLine,
    confirmMessage,
  };
}

export function sectionSummarySubline(section: SdsSection): string {
  const parts = [
    section.finish_type.trim(),
    section.system_material.trim(),
    section.color.trim(),
  ].filter(Boolean);
  return parts.join(" · ");
}
