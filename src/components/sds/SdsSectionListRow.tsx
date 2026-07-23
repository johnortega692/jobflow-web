import type { DragEvent } from "react";
import type { SdsPacketType } from "../../lib/sdsPacketPresets";
import {
  sectionAttachmentBadges,
  sectionSummarySubline,
} from "../../lib/sdsPacketRequirements";
import { sdsNotesPreview, sdsSectionNotes } from "../../lib/sdsSectionDisplay";
import type { SdsSection } from "../../types/tradeDocuments";

type Props = {
  section: SdsSection;
  index: number;
  packetType: SdsPacketType;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

export function SdsSectionListRow({
  section,
  index,
  packetType,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onEdit,
  onRemove,
}: Props) {
  const badges = sectionAttachmentBadges(section, packetType);
  const title =
    [section.manufacturer.trim(), section.product.trim()].filter(Boolean).join(" · ") ||
    "Untitled section";
  const subline = sectionSummarySubline(section);
  const notes = sdsNotesPreview(sdsSectionNotes(section), 72);

  return (
    <li
      className={`sds-section-row${dragging ? " sds-section-row--dragging" : ""}${dragOver ? " sds-section-row--dragover" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <button
        type="button"
        className="sds-section-row-handle"
        draggable
        aria-label={`Reorder section ${index + 1}`}
        title="Drag to reorder"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ⋮⋮
      </button>

      <div className="sds-section-row-body" onDoubleClick={onEdit}>
        <div className="sds-section-row-top">
          <span className="sds-section-row-num muted small">{index + 1}</span>
          <span className="sds-section-row-category muted small">{section.category}</span>
          {section.spec_section.trim() ? (
            <span className="sds-section-row-spec muted small">{section.spec_section.trim()}</span>
          ) : null}
          <strong className="sds-section-row-title">{title}</strong>
        </div>
        {(subline || notes) && (
          <p className="sds-section-row-sub muted small">
            {subline}
            {subline && notes ? " · " : ""}
            {notes}
          </p>
        )}
        {badges.length > 0 && (
          <div className="sds-section-row-badges" aria-label="Attachments">
            {badges.map((badge) => (
              <span
                key={badge.kind}
                className={`sds-att-badge${badge.state === "missing_required" ? " sds-att-badge--warn" : ""}`}
                title={badge.state === "missing_required" ? `Required: ${badge.label}` : badge.label}
              >
                {badge.state === "missing_required" ? `⚠ ${badge.label}` : badge.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sds-section-row-actions">
        <button type="button" className="btn btn-secondary btn-small" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}
