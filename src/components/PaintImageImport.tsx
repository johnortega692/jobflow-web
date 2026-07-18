import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { PaintImportPreviewModal } from "./PaintImportPreviewModal";
import {
  extractPaintFromImage,
  imageFileFromDataTransfer,
  type ExtractedPaintRow,
} from "../lib/paintImageImport";

type PreviewState = {
  rows: ExtractedPaintRow[];
  imageUrl: string;
};

type Props = {
  onImported: (rows: ExtractedPaintRow[]) => void;
  /** Kept for call-site compatibility; drop zone layout is the same either way. */
  layout?: "stack" | "row";
};

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException
    ? e.name === "AbortError"
    : e instanceof Error && e.name === "AbortError";
}

function ClipboardIcon() {
  return (
    <svg
      className="ai-import-zone-icon"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1H9V5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12h6M9 16h4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="ai-import-zone-icon ai-import-zone-spinner"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PaintImageImport({ onImported }: Props) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function closePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
  }

  function openPreview(rows: ExtractedPaintRow[], file: File) {
    closePreview();
    const imageUrl = URL.createObjectURL(file);
    previewUrlRef.current = imageUrl;
    setPreview({ rows, imageUrl });
  }

  function confirmPreview(rows: ExtractedPaintRow[]) {
    onImported(rows);
    setLastCount(rows.length);
    closePreview();
  }

  function cancelImport() {
    abortRef.current?.abort();
    abortRef.current = null;
    setImporting(false);
    setActiveFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function resetToIdle() {
    setError(null);
    setActiveFileName(null);
    setDragOver(false);
    zoneRef.current?.focus();
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPG, etc.).");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setImporting(true);
    setError(null);
    setActiveFileName(file.name || "screenshot");

    try {
      const rows = await extractPaintFromImage(file, controller.signal);
      if (controller.signal.aborted) return;
      openPreview(rows, file);
    } catch (e) {
      if (isAbortError(e) || controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setImporting(false);
      setActiveFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onPaste(e: ClipboardEvent) {
    if (importing) return;
    const file = imageFileFromDataTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    void onFile(file);
  }

  function onDragOver(e: DragEvent) {
    if (importing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (importing) return;
    const file =
      imageFileFromDataTransfer(e.dataTransfer) ??
      Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")) ??
      null;
    void onFile(file);
  }

  function onZoneClick(e: MouseEvent) {
    if (importing || error) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, label")) return;
    zoneRef.current?.focus();
  }

  function onZoneKeyDown(e: KeyboardEvent) {
    if (importing || error) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      zoneRef.current?.focus();
    }
  }

  function onChooseFileClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (importing) return;
    inputRef.current?.click();
  }

  const zoneClass = [
    "ai-import-zone",
    importing ? "ai-import-zone--reading" : "",
    dragOver ? "ai-import-zone--dragover" : "",
    error ? "ai-import-zone--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        ref={zoneRef}
        className={zoneClass}
        tabIndex={0}
        role="group"
        aria-label="Import paint schedule — paste a screenshot, drop an image, or choose a file"
        aria-busy={importing}
        onClick={onZoneClick}
        onKeyDown={onZoneKeyDown}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />

        {importing ? (
          <div className="ai-import-zone-inner ai-import-zone-inner--reading">
            <SpinnerIcon />
            <div className="ai-import-zone-copy">
              <p className="ai-import-zone-title">Reading schedule…</p>
              <p className="ai-import-zone-sub muted">
                {activeFileName ?? "screenshot"}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-small ai-import-zone-cancel"
              onClick={(e) => {
                e.stopPropagation();
                cancelImport();
              }}
            >
              Cancel
            </button>
          </div>
        ) : error ? (
          <div className="ai-import-zone-inner ai-import-zone-inner--error">
            <ClipboardIcon />
            <div className="ai-import-zone-copy">
              <p className="ai-import-zone-title">Import failed</p>
              <p className="ai-import-zone-sub ai-import-zone-error-msg">{error}</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={(e) => {
                e.stopPropagation();
                resetToIdle();
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="ai-import-zone-inner">
            <ClipboardIcon />
            <div className="ai-import-zone-copy">
              <p className="ai-import-zone-title">Import paint schedule</p>
              <p className="ai-import-zone-sub muted">
                Click here and paste a screenshot (Ctrl+V), drop an image, or{" "}
                <button
                  type="button"
                  className="ai-import-zone-file-link"
                  onClick={onChooseFileClick}
                >
                  choose a file
                </button>{" "}
                — AI reads the table and adds rows to Paint items for review.
              </p>
              {lastCount !== null && (
                <p className="muted small ai-import-zone-success">
                  Added {lastCount} item(s). Review below, then Save.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {preview ? (
        <PaintImportPreviewModal
          rows={preview.rows}
          imageUrl={preview.imageUrl}
          onConfirm={confirmPreview}
          onCancel={closePreview}
        />
      ) : null}
    </>
  );
}
