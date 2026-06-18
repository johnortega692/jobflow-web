import { useRef, useState } from "react";
import {
  extractPaintFromImage,
  imageFileFromClipboard,
  imageFileFromDataTransfer,
  type ExtractedPaintRow,
} from "../lib/paintImageImport";

type Props = {
  onImported: (rows: ExtractedPaintRow[], mode: "replace" | "append") => void;
};

export function PaintImageImport({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [lastCount, setLastCount] = useState<number | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const rows = await extractPaintFromImage(file);
      onImported(rows, mode);
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
      onImported(rows, mode);
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
      className="card stack ai-import ai-import-paste-zone"
      tabIndex={0}
      onPaste={onPaste}
      aria-label="AI paint import — paste screenshot with Ctrl+V"
    >
      <div>
        <h3>AI import from image</h3>
        <p className="muted small">
          Screenshot a paint schedule (Win+Shift+S), then <strong>paste here</strong> or use the
          buttons below. Claude reads label, manufacturer, color, product, and sheen.
        </p>
      </div>

      <div className="row-gap">
        <label className="check">
          <input
            type="radio"
            name="import-mode"
            checked={mode === "replace"}
            onChange={() => setMode("replace")}
          />
          Replace all rows
        </label>
        <label className="check">
          <input
            type="radio"
            name="import-mode"
            checked={mode === "append"}
            onChange={() => setMode("append")}
          />
          Append to list
        </label>
      </div>

      <div className="row-gap">
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
          <span className="muted small">Imported {lastCount} item(s). Review below, then Save.</span>
        )}
      </div>

      <p className="muted small ai-import-hint">
        Tip: click this box, then <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste a screenshot.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <p className="muted small">
        Requires <code>ANTHROPIC_API_KEY</code> on Vercel (or in <code>.env.local</code> for local{" "}
        <code>dev.bat</code>).
      </p>
    </section>
  );
}
