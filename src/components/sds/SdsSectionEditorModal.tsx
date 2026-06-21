import { useState, type DragEvent } from "react";
import { parseSdsFilename, removeSdsPdf, uploadSdsPdf } from "../../lib/sdsFileStorage";
import { sanitizeFinishType } from "../../lib/sdsSectionModel";
import {
  SDS_ATTACHMENT_KINDS,
  SDS_SECTION_CATEGORIES,
  notesFromAttachments,
  type SdsAttachmentKind,
} from "../../lib/sdsSectionModel";
import type { SdsSection, SdsSectionCategory } from "../../types/tradeDocuments";

type Props = {
  title: string;
  section: SdsSection;
  projectId: string;
  onSave: (section: SdsSection) => void;
  onClose: () => void;
};

export function SdsSectionEditorModal({ title, section: initial, projectId, onSave, onClose }: Props) {
  const [section, setSection] = useState<SdsSection>({ ...initial });
  const [uploading, setUploading] = useState<SdsAttachmentKind | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (!next.intended_use.trim() || next.intended_use.startsWith("Include ")) {
        next.intended_use = notesFromAttachments(next);
        if (next.intended_use === "—") next.intended_use = "";
      }
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
        className="modal card stack sds-section-editor"
        role="dialog"
        aria-labelledby="sds-section-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="sds-section-editor-title">{title}</h3>
        <p className="muted small">
          Enter section details once, then attach product data, SDS, warranty, LEED/HPD/EPD, test reports,
          and maintenance PDFs. Drop a PDF onto each row or use Browse. Name files like{" "}
          <code>PPG - Speedhide - Eggshell.pdf</code> or <code>PPG - Speedhide - Eggshell - SDS.pdf</code>{" "}
          — the finish field stays <strong>Eggshell</strong> (attachment type comes from the row you use).
        </p>
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
            />
          </label>
        </div>
        <div className="stack">
          {SDS_ATTACHMENT_KINDS.map(({ kind, label }) => (
            <FilePickRow
              key={kind}
              label={label}
              filename={section.attachments[kind]?.filename ?? ""}
              busy={uploading === kind}
              onPick={(f) => void onUploadFile(kind, f)}
              onClear={() => void clearFile(kind)}
            />
          ))}
        </div>
        <div className="row-gap wrap">
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FilePickRow({
  label,
  filename,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  filename: string;
  busy: boolean;
  onPick: (file: File | null) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <div
      className={`sds-file-row stack${dragOver ? " sds-file-row-dragover" : ""}${filename ? " sds-file-row-has-file" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="muted small">{label}</span>
      <div className="row-gap wrap sds-file-row-actions">
        <span className="small sds-file-row-name">{filename || "Drop PDF here"}</span>
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
        {filename && (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
