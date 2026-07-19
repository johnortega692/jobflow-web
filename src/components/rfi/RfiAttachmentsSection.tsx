import { useRef, useState, type DragEvent } from "react";
import {
  isRfiAttachmentFile,
  removeRfiAttachment,
  uploadRfiAttachment,
} from "../../lib/rfiFileStorage";
import type { RfiAttachedFile, RfiFormData } from "../../types/database";

type Props = {
  projectId: string;
  rfiId: string;
  form: RfiFormData;
  setField: <K extends keyof RfiFormData>(key: K, value: RfiFormData[K]) => void;
  onFilesPersisted: (files: RfiAttachedFile[]) => Promise<void>;
  onError: (message: string) => void;
};

export function RfiAttachmentsSection({
  projectId,
  rfiId,
  form,
  setField,
  onFilesPersisted,
  onError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function addFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    const accepted = incoming.filter(isRfiAttachmentFile);
    if (!accepted.length) {
      onError("Attach PDF, JPG, or PNG files only.");
      return;
    }
    if (accepted.length < incoming.length) {
      onError("Some files were skipped — only PDF, JPG, and PNG are supported.");
    }

    setBusy(true);
    onError("");
    try {
      const uploaded: RfiAttachedFile[] = [];
      for (const file of accepted) {
        const id = crypto.randomUUID();
        const { path, filename } = await uploadRfiAttachment(projectId, rfiId, id, file);
        uploaded.push({ id, filename, storage_path: path });
      }
      const next = [...form.attached_files, ...uploaded];
      setField("attached_files", next);
      await onFilesPersisted(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeSelected() {
    const file = form.attached_files.find((f) => f.id === selectedId);
    if (!file) return;
    setBusy(true);
    onError("");
    try {
      await removeRfiAttachment(file.storage_path);
      const next = form.attached_files.filter((f) => f.id !== file.id);
      setField("attached_files", next);
      setSelectedId(null);
      await onFilesPersisted(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove file");
    } finally {
      setBusy(false);
    }
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
    if (busy) return;
    void addFiles(e.dataTransfer.files);
  }

  return (
    <section className="card stack">
      <h2>Attachments</h2>
      <div className="rfi-attachments-layout">
        <div className="rfi-attachments-checks stack">
          <p className="muted small">Listed on PDF</p>
          <div className="rfi-chip-row rfi-attachments-chip-row" role="group" aria-label="Listed on PDF">
            {(
              [
                { key: "attach_photos" as const, label: "Field photo(s)" },
                { key: "attach_markup" as const, label: "Marked-up PDF / clouded drawing" },
                { key: "attach_submittal" as const, label: "Submittal / product data sheet" },
              ] as const
            ).map(({ key, label }) => {
              const selected = form[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`rfi-chip${selected ? " rfi-chip--selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => setField(key, !selected)}
                >
                  {selected ? <span className="rfi-chip-check" aria-hidden="true">✓</span> : null}
                  {label}
                </button>
              );
            })}
            <input
              className="rfi-attachments-other-input"
              value={form.attach_other}
              onChange={(e) => setField("attach_other", e.target.value)}
              placeholder="Other attachment note"
              aria-label="Other attachment note"
            />
          </div>
        </div>

        <div className="rfi-attachments-upload stack">
          <div className="row-between wrap">
            <p className="muted small">Upload files (appended as pages in PDF)</p>
            <div className="row-gap">
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                multiple
                className="sr-only"
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Browse…
              </button>
              {selectedId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void removeSelected()}
                >
                  Remove selected
                </button>
              )}
            </div>
          </div>

          <div
            className={`rfi-attachments-drop${dragOver ? " rfi-attachments-drop-dragover" : ""}${form.attached_files.length ? " rfi-attachments-drop-has-files" : ""}`}
            tabIndex={0}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => {
              if (!busy && !form.attached_files.length) inputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            aria-label="Drop PDF or image files here, or browse to attach"
          >
            {busy ? (
              <p className="muted small">Uploading…</p>
            ) : form.attached_files.length ? (
              <ul className="rfi-attachments-list">
                {form.attached_files.map((file) => (
                  <li key={file.id}>
                    <label className="check rfi-attachments-list-item">
                      <input
                        type="radio"
                        name="rfi-attachment"
                        checked={selectedId === file.id}
                        onChange={() => setSelectedId(file.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="rfi-attachments-filename">{file.filename}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <strong>Drop files here</strong>
                <span className="muted small">PDF, JPG, or PNG — or click to browse</span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
