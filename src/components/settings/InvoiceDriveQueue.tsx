import { useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/apiAuth";
import type { DriveFolderFile } from "../../lib/driveFolder";

const DEFAULT_FOLDER = "https://drive.google.com/drive/folders/1F_Cg1YKcDGG6_P_CBzuvIActmXif6Snv?usp=sharing";
const FOLDER_KEY = "jobflow.invoiceDrive.folder";
const DONE_KEY = "jobflow.invoiceDrive.done";

type Props = {
  disabled?: boolean;
  activeFileId: string | null;
  onOpen: (file: File, fileId: string) => void;
  onFinished: () => void;
};

function readDone(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function InvoiceDriveQueue({ disabled, activeFileId, onOpen, onFinished }: Props) {
  const [folder, setFolder] = useState(() => localStorage.getItem(FOLDER_KEY) || DEFAULT_FOLDER);
  const [draft, setDraft] = useState(folder);
  const [files, setFiles] = useState<DriveFolderFile[]>([]);
  const [done, setDone] = useState<string[]>(readDone);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [showChecked, setShowChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  async function load(nextFolder: string) {
    const link = nextFolder.trim();
    if (!link) {
      setFiles([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/drive-folder", {
        method: "POST",
        body: JSON.stringify({ action: "list", folder: link }),
      });
      const body = (await response.json()) as { files?: DriveFolderFile[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not open that Drive folder.");
      setFiles(body.files ?? []);
    } catch (cause) {
      setFiles([]);
      setError(cause instanceof Error ? cause.message : "Could not open that Drive folder.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (folder.trim()) void load(folder);
  }, [folder]);

  function placeMenu() {
    const button = menuButtonRef.current;
    const panel = menuPanelRef.current;
    if (!button || !panel) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - 12 - width);
    const top = rect.bottom + 6;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(220, Math.min(440, window.innerHeight - top - 12))}px`;
  }

  useEffect(() => {
    if (!menuOpen) return;
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuOpen]);

  function saveFolder() {
    const link = draft.trim();
    localStorage.setItem(FOLDER_KEY, link);
    setFolder(link);
  }

  async function openFile(file: DriveFolderFile) {
    if (disabled || openingId) return;
    setOpeningId(file.id);
    setError(null);
    try {
      const response = await authFetch("/api/drive-folder", {
        method: "POST",
        body: JSON.stringify({ action: "file", fileId: file.id }),
      });
      const body = (await response.json()) as { pdfBase64?: string; error?: string };
      if (!response.ok || !body.pdfBase64) throw new Error(body.error || "Could not open that Drive PDF.");
      const pdf = new File([bytesFromBase64(body.pdfBase64)], file.name, { type: "application/pdf" });
      onOpen(pdf, file.id);
      menuPanelRef.current?.hidePopover();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that Drive PDF.");
    } finally {
      setOpeningId(null);
    }
  }

  function hideFile(id: string) {
    const next = [...new Set([...done, id])].slice(-500);
    localStorage.setItem(DONE_KEY, JSON.stringify(next));
    setDone(next);
    if (id === activeFileId) onFinished();
  }

  function showFile(id: string) {
    const next = done.filter((item) => item !== id);
    localStorage.setItem(DONE_KEY, JSON.stringify(next));
    setDone(next);
  }

  const waiting = files.filter((file) => !done.includes(file.id));
  const checkedCount = files.length - waiting.length;
  const shown = showChecked ? files : waiting;
  const activeName = files.find((file) => file.id === activeFileId)?.name;

  return (
    <div className="read-invoice-drive">
      <button
        ref={menuButtonRef}
        type="button"
        className={`btn btn-secondary btn-sm read-invoice-drive-trigger${menuOpen ? " is-open" : ""}`}
        popoverTarget="invoice-drive-menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        disabled={disabled}
      >
        {loading ? "Invoices…" : waiting.length ? `Invoices · ${waiting.length}` : "Invoices"}
        <svg className="read-invoice-drive-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {activeName ? <span className="read-invoice-drive-current">{activeName}</span> : null}
      {error && !menuOpen ? <p className="read-invoice-drive-error">{error}</p> : null}
      <div
        id="invoice-drive-menu"
        ref={menuPanelRef}
        className="read-invoice-drive-panel"
        popover="auto"
        role="dialog"
        aria-label="Drive invoices"
        onToggle={(event) => {
          const open = event.newState === "open";
          if (open) placeMenu();
          setMenuOpen(open);
        }}
      >
        <div className="read-invoice-drive-panel-head">
          <span>Check a PDF to hide it. The file stays in Drive.</span>
          {checkedCount > 0 ? (
            <button type="button" className="read-invoice-drive-toggle" onClick={() => setShowChecked((value) => !value)}>
              {showChecked ? "Hide checked" : `${checkedCount} checked`}
            </button>
          ) : null}
        </div>
        {error ? <p className="read-invoice-drive-error">{error}</p> : null}
        {shown.length ? (
          <ul className="read-invoice-drive-list">
            {shown.map((file) => {
              const checked = done.includes(file.id);
              return (
                <li key={file.id} className={file.id === activeFileId ? "is-open" : undefined}>
                  <label className="read-invoice-drive-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      aria-label={checked ? `Show ${file.name}` : `Hide ${file.name}`}
                      onChange={() => (checked ? showFile(file.id) : hideFile(file.id))}
                    />
                  </label>
                  <button
                    type="button"
                    className={checked ? "is-checked" : undefined}
                    disabled={disabled || openingId != null}
                    onClick={() => void openFile(file)}
                  >
                    {openingId === file.id ? "Opening…" : file.name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : folder && !loading && !error ? (
          <p className="read-invoice-drive-note">No PDFs are waiting.</p>
        ) : null}
        <details className="read-invoice-drive-folder">
          <summary>Folder</summary>
          <div className="read-invoice-drive-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveFolder();
              }}
              placeholder="Google Drive folder link"
              aria-label="Google Drive folder link"
              disabled={disabled || loading}
            />
            <button type="button" className="btn btn-sm" disabled={disabled || loading} onClick={saveFolder}>
              {loading ? "Looking…" : "Use"}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
