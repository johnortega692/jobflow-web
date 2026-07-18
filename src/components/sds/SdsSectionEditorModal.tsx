import { useId, useState, type DragEvent } from "react";
import type { SdsPacketType } from "../../lib/sdsPacketPresets";
import { requiredAttachmentsForPacketType } from "../../lib/sdsPacketRequirements";
import { parseSdsFilename, removeSdsPdf, uploadSdsPdf } from "../../lib/sdsFileStorage";
import {
  SDS_ATTACHMENT_KINDS,
  SDS_SECTION_CATEGORIES,
  sanitizeFinishType,
  type SdsAttachmentKind,
} from "../../lib/sdsSectionModel";
import type { SdsSection, SdsSectionCategory } from "../../types/tradeDocuments";

type Props = {
  mode: "add" | "edit";
  section: SdsSection;
  projectId: string;
  packetType: SdsPacketType;
  onSave: (section: SdsSection) => void;
  onClose: () => void;
};

export function SdsSectionEditorModal({
  mode,
  section: initial,
  projectId,
  packetType,
  onSave,
  onClose,
}: Props) {
  const [section, setSection] = useState<SdsSection>({ ...initial });
  const [uploading, setUploading] = useState<SdsAttachmentKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const requiredKinds = new Set(requiredAttachmentsForPacketType(packetType));
  const title = mode === "add" ? "Add section" : "Edit section";

  function patch(patch: Partial<SdsSection>) {
    setSection((s) => ({ ...s, ...patch }));
  }

  async function onUploadFile(kind: SdsAttachmentKind, file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    setUploading(kind);
    setError(null);
    try {
      const meta = parseSdsFilename(file.name);
      const { path, filename } = await uploadSdsPdf(projectId, section.id, kind, file);
      const attachments = {
        ...section.attachments,
        [kind]: { path, filename },
      };
      const next: SdsSection = {
        ...section,
        attachments,
        ...(meta.manufacturer ? { manufacturer: meta.manufacturer } : {}),
        ...(meta.product ? { product: meta.product } : {}),
        ...(meta.finish_type ? { finish_type: meta.finish_type } : {}),
      };
      setSection(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function clearFile(kind: SdsAttachmentKind) {
    const attachment = section.attachments[kind];
    try {
      if (attachment?.path) await removeSdsPdf(attachment.path);
    } catch {
      /* ignore */
    }
    const attachments = { ...section.attachments };
    delete attachments[kind];
    patch({ attachments });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card sds-section-editor"
        role="dialog"
        aria-labelledby="sds-section-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sds-section-editor-header">
          <div className="sds-section-editor-header-row">
            <h3 id="sds-section-editor-title">{title}</h3>
            <div className="sds-section-editor-packet-meta">
              <span className="muted small sds-section-editor-packet-type">{packetType}</span>
              <div className="sds-filename-tip">
                <button
                  type="button"
                  className="sds-filename-tip-btn"
                  aria-label="File naming convention"
                  aria-expanded={tipOpen}
                  aria-controls={tipId}
                  onClick={() => setTipOpen((open) => !open)}
                >
                  ⓘ
                </button>
                {tipOpen && (
                  <div id={tipId} className="sds-filename-tip-popover" role="note">
                    Name files like{" "}
                    <code>PPG - Speedhide - Eggshell.pdf</code> or{" "}
                    <code>PPG - Speedhide - Eggshell - SDS.pdf</code> — the finish field stays{" "}
                    <strong>Eggshell</strong> (attachment type comes from the slot you use).
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="muted small sds-section-editor-intro">
            Attach PDFs per type — drop onto a slot or Browse.
          </p>
        </header>

        <div className="sds-section-editor-body stack">
          {error && <div className="banner banner-error">{error}</div>}
          <div className="grid-2">
            <label>
              Category
              <select
                value={section.category}
                onChange={(e) => patch({ category: e.target.value as SdsSectionCategory })}
              >
                {SDS_SECTION_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Manufacturer
              <input
                value={section.manufacturer}
                onChange={(e) => patch({ manufacturer: e.target.value })}
              />
            </label>
            <label>
              Product
              <input value={section.product} onChange={(e) => patch({ product: e.target.value })} />
            </label>
            <label>
              Finish / Type
              <input
                value={section.finish_type}
                onChange={(e) => patch({ finish_type: e.target.value })}
                placeholder="Eggshell, Type II Vinyl, Class A…"
              />
            </label>
            <label>
              System / Material
              <input
                value={section.system_material}
                onChange={(e) => patch({ system_material: e.target.value })}
                placeholder="Interior Paint, Vinyl Wallcovering…"
              />
            </label>
            <label>
              Color / Pattern / Finish
              <input value={section.color} onChange={(e) => patch({ color: e.target.value })} />
            </label>
            <label className="grid-span-2">
              Notes / intended use
              <input
                value={section.intended_use}
                onChange={(e) => patch({ intended_use: e.target.value })}
                placeholder="Optional — TDS/SDS attachments are listed separately"
              />
            </label>
          </div>

          <div className="stack sds-attachments-block">
            <h4 className="sds-attachments-heading">Attachments</h4>
            <div className="sds-attachments-grid">
              {SDS_ATTACHMENT_KINDS.map(({ kind, label }) => {
                const filename = section.attachments[kind]?.filename ?? "";
                const required = requiredKinds.has(kind);
                return (
                  <FilePickSlot
                    key={kind}
                    label={label}
                    filename={filename}
                    required={required}
                    busy={uploading === kind}
                    onPick={(f) => void onUploadFile(kind, f)}
                    onClear={() => void clearFile(kind)}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <footer className="sds-section-editor-footer">
          <span className="sds-section-editor-footer-status" aria-live="polite" />
          <div className="row-gap wrap sds-section-editor-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onSave({
                  ...section,
                  finish_type: sanitizeFinishType(section.finish_type),
                })
              }
            >
              Save section
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FilePickSlot({
  label,
  filename,
  required,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  filename: string;
  required: boolean;
  busy: boolean;
  onPick: (file: File | null) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const hasFile = Boolean(filename.trim());
  const emptyRequired = required && !hasFile;

  function pickPdfFromDataTransfer(dataTransfer: DataTransfer | null) {
    if (!dataTransfer?.files.length || busy) return;
    const file = [...dataTransfer.files].find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (file) onPick(file);
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) setDragOver(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    pickPdfFromDataTransfer(e.dataTransfer);
  }

  const stateClass = hasFile
    ? "sds-file-slot--filled"
    : emptyRequired
      ? "sds-file-slot--required-empty"
      : "sds-file-slot--empty";

  return (
    <div
      className={`sds-file-slot stack${stateClass}${dragOver ? " sds-file-slot--dragover" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="sds-file-slot-top">
        <span className={`sds-file-slot-label${hasFile ? "" : " muted"}`}>{label}</span>
        {required && <span className="sds-file-slot-required">Required</span>}
      </div>
      <p className={`sds-file-slot-name small${hasFile ? "" : " muted"}`}>
        {hasFile ? filename : "Drop PDF here"}
      </p>
      <div className="row-gap wrap sds-file-slot-actions">
        <label className="btn btn-secondary btn-small">
          {busy ? "Uploading…" : "Browse"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={busy}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>
        {hasFile && (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
