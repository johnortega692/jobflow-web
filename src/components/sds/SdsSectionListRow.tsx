import type { DragEvent } from "react";
import type { SdsPacketType } from "../../lib/sdsPacketPresets";
import { sectionAttachmentBadges } from "../../lib/sdsPacketRequirements";
import { intendedUseHasSelfPriming } from "../../lib/sdsSectionModel";
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
  showSelfPriming?: boolean;
  onSelfPrimingChange?: (on: boolean) => void;
};

function colorPieces(color: string): { tag: string; location: string }[] {
  return color
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const splitAt = part.indexOf("—");
      if (splitAt === -1) return { tag: part, location: "" };
      return {
        tag: part.slice(0, splitAt).trim(),
        location: part.slice(splitAt + 1).trim(),
      };
    })
    .filter((piece) => piece.tag || piece.location);
}

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
  showSelfPriming = false,
  onSelfPrimingChange,
}: Props) {
  const badges = sectionAttachmentBadges(section, packetType);
  const title =
    [section.manufacturer.trim(), section.product.trim()].filter(Boolean).join(" · ") ||
    "Untitled section";
  const pieces = colorPieces(section.color);
  const locations = [...new Set(pieces.map((piece) => piece.location).filter(Boolean))];
  const detail = [section.finish_type.trim(), section.system_material.trim(), ...locations]
    .filter(Boolean)
    .join(" · ");
  const colorTags = pieces.map((piece) => piece.tag).filter(Boolean);
  const spec = section.spec_section.trim();

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
          {spec ? <span className="sds-section-row-spec">{spec}</span> : null}
          <strong className="sds-section-row-title">{title}</strong>
        </div>
        {detail ? <p className="sds-section-row-sub muted small">{detail}</p> : null}
        {showSelfPriming ? (
          <label className="check sds-self-prime" onDoubleClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={intendedUseHasSelfPriming(section.intended_use)}
              onChange={(event) => onSelfPrimingChange?.(event.target.checked)}
            />
            Self-priming
          </label>
        ) : null}
        {section.intended_use.trim() ? (
          <p className="sds-section-row-sub sds-section-row-notes muted small">Notes: {section.intended_use.trim()}</p>
        ) : null}
        {colorTags.length > 0 ? (
          <div className="sds-section-colors">
            {colorTags.map((tag, tagIndex) => (
              <span key={`${tag}-${tagIndex}`} className="sds-section-color-tag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
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
        <button type="button" className="sds-section-icon-btn" title="Edit" aria-label="Edit section" onClick={onEdit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          type="button"
          className="sds-section-icon-btn sds-section-icon-btn--danger"
          title="Remove"
          aria-label="Remove section"
          onClick={onRemove}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      </div>
    </li>
  );
}
