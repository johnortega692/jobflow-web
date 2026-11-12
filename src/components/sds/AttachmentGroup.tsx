import { useState, type DragEvent } from "react";
import type { SdsFileAttachment } from "../../lib/sdsSectionModel";

type Props = {
  label: string;
  files: SdsFileAttachment[];
  required: boolean;
  onAdd: (files: File[]) => void;
  onReplace: (index: number, file: File) => void;
  onRemove: (index: number) => void;
  busy?: boolean;
  replacingIndex?: number | null;
};

function pdfFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return [...list].filter((file) => file.name.toLowerCase().endsWith(".pdf"));
}

export function AttachmentGroup({
  label,
  files,
  required,
  onAdd,
  onReplace,
  onRemove,
  busy = false,
  replacingIndex = null,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const hasFile = files.length > 0;
  const emptyRequired = required && !hasFile;
  const stateClass = hasFile
    ? "sds-attach-card--filled"
    : emptyRequired
      ? "sds-attach-card--required-empty"
      : "sds-attach-card--empty";

  function addFromList(list: FileList | null) {
    const next = pdfFiles(list);
    if (next.length) onAdd(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (busy) return;
    const next = pdfFiles(event.dataTransfer.files);
    if (next.length) onAdd(next);
  }

  return (
    <div
      className={`sds-attach-card ${stateClass}${dragOver ? " sds-attach-card--dragover" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="sds-attach-head">
        <div className="sds-attach-head-main">
          <span className="sds-attach-label">{label}</span>
          {files.length >= 2 ? <span className="sds-attach-count">{files.length} files</span> : null}
          {required ? <span className="sds-file-slot-required">Required</span> : null}
        </div>
        <label className={`btn btn-secondary btn-small sds-attach-add${busy ? " is-disabled" : ""}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          {busy && replacingIndex === null ? "Uploading…" : "Add file"}
          <input
            type="file"
            accept="application/pdf"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              addFromList(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {hasFile ? (
        <ul className="sds-attach-files">
          {files.map((file, index) => (
            <li key={`${file.path}-${index}`} className="sds-attach-row">
              <svg className="sds-attach-pdf" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <span className="sds-attach-name" title={file.filename || "PDF"}>
                {file.filename || "PDF"}
              </span>
              <label className="btn btn-secondary btn-small">
                {replacingIndex === index ? "Uploading…" : "Replace"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.files?.[0];
                    if (next?.name.toLowerCase().endsWith(".pdf")) onReplace(index, next);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="sds-section-icon-btn sds-attach-remove"
                aria-label="Remove file"
                disabled={busy}
                onClick={() => onRemove(index)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`sds-attach-empty${emptyRequired ? " sds-attach-empty--required" : ""}`}>
          Drop PDFs here or use Add file
        </p>
      )}
    </div>
  );
}
