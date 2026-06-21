import { useRef, useState } from "react";
import {
  extractPaintFromImage,
  imageFileFromClipboard,
  imageFileFromDataTransfer,
  type ExtractedPaintRow,
} from "../lib/paintImageImport";

type Props = {
  onImported: (rows: ExtractedPaintRow[]) => void;
  layout?: "stack" | "row";
};

export function PaintImageImport({ onImported, layout = "stack" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const rows = await extractPaintFromImage(file);
      onImported(rows);
      setLastCount(rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onPasteClick() {
    setImporting(true);
    setError(null);
    try {
      const file = await imageFileFromClipboard();
      if (!file) {
        setError("No image on clipboard. Copy a screenshot first (Win+Shift+S), then try again.");
        return;
      }
      const rows = await extractPaintFromImage(file);
      onImported(rows);
      setLastCount(rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paste failed");
    } finally {
      setImporting(false);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const file = imageFileFromDataTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    void onFile(file);
  }

  return (
    <section
      className={`card ai-import ai-import-paste-zone${layout === "row" ? " ai-import--row" : " stack"}`}
      tabIndex={0}
      onPaste={onPaste}
      aria-label="Import paint schedule — paste a screenshot or select an image"
    >
      <div className={layout === "row" ? "ai-import-row-main" : undefined}>
        <div>
          <h3>Import Paint Schedule</h3>
          <p className="muted small">Paste a screenshot or select an image.</p>
        </div>

        <div className="row-gap ai-import-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={importing}
            onClick={() => void onPasteClick()}
          >
            {importing ? "Reading image…" : "Paste from clipboard"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
          >
            Choose image…
          </button>
          {lastCount !== null && !error && (
            <span className="muted small">
              Added {lastCount} item(s). Review below, then Save.
            </span>
          )}
        </div>
      </div>

      {layout === "row" ? (
        error ? (
          <div className="banner banner-error ai-import-row-banner">{error}</div>
        ) : (
          <p className="muted small ai-import-hint ai-import-row-hint">
            Tip: click this box, then <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste a screenshot.
          </p>
        )
      ) : (
        <>
          <p className="muted small ai-import-hint">
            Tip: click this box, then <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste a screenshot.
          </p>
          {error && <div className="banner banner-error">{error}</div>}
        </>
      )}
    </section>
  );
}
