import {
  SDS_ATTACHMENT_KINDS,
  attachmentSummary,
  notesFromAttachments,
  sectionHasAttachment,
} from "./sdsSectionModel";
import type { SdsAttachmentKind } from "./sdsSectionModel";
import type { SdsSection } from "../types/tradeDocuments";

export function sdsNotesPreview(text: string, maxLen = 42): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export function sdsSectionNotes(section: SdsSection): string {
  return notesFromAttachments(section);
}

export function sdsFileMark(hasFile: boolean): string {
  return hasFile ? "✓" : "✗";
}

export function sdsAttachmentSummary(section: SdsSection): string {
  return attachmentSummary(section);
}

export function sdsHasAttachment(section: SdsSection, kind: SdsAttachmentKind): boolean {
  return sectionHasAttachment(section, kind);
}

export { SDS_ATTACHMENT_KINDS };
