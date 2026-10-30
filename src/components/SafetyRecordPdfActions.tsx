import { useState } from "react";
import { openSafetyRecordPdf } from "../lib/safetyRecords";

export function SafetyRecordPdfActions({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState<"" | "view" | "download">("");
  const [error, setError] = useState<string | null>(null);
  if (!path) return null;

  async function open(download: boolean) {
    setBusy(download ? "download" : "view");
    setError(null);
    try {
      await openSafetyRecordPdf(path, filename, download);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the PDF.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(false)}>
        {busy === "view" ? "Opening…" : "View PDF"}
      </button>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(true)}>
        {busy === "download" ? "Downloading…" : "Download PDF"}
      </button>
      {error ? <span className="muted small">{error}</span> : null}
    </div>
  );
}
