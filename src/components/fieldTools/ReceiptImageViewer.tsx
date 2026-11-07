import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrderReceiptImage } from "../../lib/fieldToolsPoTracker";
import { esc, printHtml } from "../../lib/printCore";
import { ReceiptEditorModal, rotateEditedReceipt, type EditedReceipt } from "./ReceiptEditorModal";

type Props = {
  receipts: OrderReceiptImage[];
  poNumber: string;
  onDelete?: (receiptId: string) => Promise<void>;
  /** Render Print here (for example a modal header) instead of the zoom toolbar. Null while that slot mounts. */
  printTarget?: HTMLElement | null;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
}

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Rotation = 0 | 90 | 180 | 270;

const ROTATION_KEY = "jobflow.receiptRotation.v1";

function loadRotations(): Record<string, Rotation> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ROTATION_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, Rotation> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === 90 || value === 180 || value === 270) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRotations(rotations: Record<string, Rotation>): void {
  try {
    window.localStorage.setItem(ROTATION_KEY, JSON.stringify(rotations));
  } catch {
    // Rotation still applies for this visit.
  }
}

function turn(current: Rotation, delta: 90 | -90): Rotation {
  return (((current + delta) % 360) + 360) % 360 as Rotation;
}

function printReceipts(poNumber: string, pages: { url: string; deg: Rotation }[]): void {
  const title = `PO ${poNumber} receipt`;
  const sheets = pages
    .map(({ url, deg }) => {
      const sideways = deg === 90 || deg === 270 ? " sideways" : "";
      return `<section class="sheet">
        <h1>PO# ${esc(poNumber)}</h1>
        <div class="frame">
          <img class="r${deg}${sideways}" src="${esc(url)}" alt="Receipt for PO ${esc(poNumber)}" />
        </div>
      </section>`;
    })
    .join("");
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: letter; margin: 0.4in; }
    html, body { margin: 0; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #111; }
    .sheet { break-after: page; display: flex; flex-direction: column; align-items: center; }
    .sheet:last-child { break-after: auto; }
    h1 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
    /* Letter minus 0.4in margins, less the PO heading. */
    .frame { width: 7.7in; height: 9.7in; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    img { flex: none; max-width: 7.7in; max-height: 9.7in; object-fit: contain; }
    img.sideways { max-width: 9.7in; max-height: 7.7in; }
    img.r90 { transform: rotate(90deg); }
    img.r180 { transform: rotate(180deg); }
    img.r270 { transform: rotate(270deg); }
  </style>
</head>
<body>${sheets}</body>
</html>`;
  printHtml(html, title);
}

export function ReceiptImageViewer({ receipts, poNumber, onDelete, printTarget }: Props) {
  const [zoom, setZoom] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rotations, setRotations] = useState<Record<string, Rotation>>(loadRotations);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [edits, setEdits] = useState<Record<string, EditedReceipt>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  zoomRef.current = zoom;

  const applyZoom = useCallback((next: number, origin?: { clientX: number; clientY: number }) => {
    const el = scrollRef.current;
    const prev = zoomRef.current;
    const clamped = clampZoom(next);
    if (el && clamped !== prev) {
      const rect = el.getBoundingClientRect();
      const ox = origin ? origin.clientX - rect.left : el.clientWidth / 2;
      const oy = origin ? origin.clientY - rect.top : el.clientHeight / 2;
      const ratio = clamped / prev;
      pendingScroll.current = {
        left: (el.scrollLeft + ox) * ratio - ox,
        top: (el.scrollTop + oy) * ratio - oy,
      };
    }
    setZoom(clamped);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScroll.current;
    if (!el || !pending) return;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
    pendingScroll.current = null;
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), {
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, receipts.length]);

  if (receipts.length === 0) return null;

  const editingReceipt = editingId ? receipts.find((receipt) => receipt.id === editingId) : undefined;

  const printButton = (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() =>
        printReceipts(
          poNumber,
          receipts.map((receipt) => {
            const edited = edits[receipt.id];
            return edited ? { url: edited.url, deg: 0 } : { url: receipt.url, deg: rotations[receipt.id] ?? 0 };
          }),
        )
      }
    >
      Print
    </button>
  );

  function rotate(receiptId: string, delta: 90 | -90) {
    const edited = edits[receiptId];
    if (edited) {
      setEditError(null);
      rotateEditedReceipt(edited, delta)
        .then((next) => setEdits((current) => ({ ...current, [receiptId]: next })))
        .catch(() => setEditError("Could not rotate the edited receipt."));
      return;
    }
    setRotations((current) => {
      const next = { ...current };
      const deg = turn(current[receiptId] ?? 0, delta);
      if (deg === 0) delete next[receiptId];
      else next[receiptId] = deg;
      saveRotations(next);
      return next;
    });
  }

  async function removeReceipt(receipt: OrderReceiptImage) {
    if (!onDelete || deletingId) return;
    const ok = window.confirm(
      "Delete this receipt photo? It will be removed from the order and cannot be restored.",
    );
    if (!ok) return;
    setDeletingId(receipt.id);
    setDeleteError(null);
    try {
      await onDelete(receipt.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete the receipt.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="receipt-zoom">
      <div className="receipt-zoom-toolbar">
        <div className="receipt-zoom-controls">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="receipt-zoom-label muted small">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom === 1}
            onClick={() => {
              setZoom(1);
              const el = scrollRef.current;
              if (el) {
                el.scrollTop = 0;
                el.scrollLeft = 0;
              }
            }}
          >
            Reset
          </button>
          <span className="muted small receipt-zoom-hint">Ctrl + scroll to zoom</span>
        </div>
        {printTarget ? createPortal(printButton, printTarget) : printTarget === undefined ? printButton : null}
      </div>
      <div
        className="receipt-zoom-viewport"
        ref={scrollRef}
        tabIndex={0}
        aria-label={`Receipt for PO ${poNumber}`}
        onKeyDown={(e) => {
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            applyZoom(zoom + ZOOM_STEP);
          } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            applyZoom(zoom - ZOOM_STEP);
          } else if (e.key === "0") {
            e.preventDefault();
            setZoom(1);
          }
        }}
      >
        {receipts.map((receipt, index) => {
          const edited = edits[receipt.id];
          const deg = edited ? 0 : (rotations[receipt.id] ?? 0);
          const size = sizes[receipt.id];
          const sideways = (deg === 90 || deg === 270) && size != null;
          const label = receipts.length > 1 ? ` receipt ${index + 1}` : " receipt";
          return (
            <div
              key={receipt.id}
              className="receipt-zoom-frame"
              style={{
                width: `${zoom * 100}%`,
                aspectRatio: sideways ? `${size.h} / ${size.w}` : undefined,
              }}
            >
              <img
                src={edited?.url ?? receipt.url}
                alt={`Receipt for PO ${poNumber}${edited ? " (edited)" : ""}`}
                className="receipt-zoom-img"
                style={
                  sideways
                    ? {
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        width: `${(size.w / size.h) * 100}%`,
                        height: `${(size.h / size.w) * 100}%`,
                        transform: `translate(-50%, -50%) rotate(${deg}deg)`,
                      }
                    : { width: "100%", transform: deg === 180 ? "rotate(180deg)" : undefined }
                }
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                  if (w && h) setSizes((current) => (current[receipt.id] ? current : { ...current, [receipt.id]: { w, h } }));
                }}
              />
              <div className="receipt-rotate-btns">
                <button
                  type="button"
                  className="receipt-rotate-btn receipt-rotate-btn--text"
                  aria-label={`Crop or mark up${label}`}
                  title="Crop / mark up"
                  onClick={() => {
                    setEditError(null);
                    setEditingId(receipt.id);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="receipt-rotate-btn"
                  aria-label={`Rotate${label} left`}
                  title="Rotate left"
                  onClick={() => rotate(receipt.id, -90)}
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="receipt-rotate-btn"
                  aria-label={`Rotate${label} right`}
                  title="Rotate right"
                  onClick={() => rotate(receipt.id, 90)}
                >
                  ↻
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {deleteError && <div className="banner banner-error">{deleteError}</div>}
      {editError && <div className="banner banner-error">{editError}</div>}
      <ul className="receipt-zoom-meta">
        {receipts.map((receipt, index) => {
          const edited = edits[receipt.id];
          return (
          <li key={receipt.id} className="receipt-zoom-meta-row muted small">
            <span>
              {formatUploadedAt(receipt.createdAt)}
              {receipt.uploadedBy ? ` · ${receipt.uploadedBy}` : ""}
              {" · "}
              <a href={receipt.url} target="_blank" rel="noreferrer">
                Open full size
              </a>
              {edited ? (
                <>
                  {" · "}
                  <strong className="receipt-edited-tag">Edited</strong>
                  {" · "}
                  <a href={edited.url} download={`PO-${poNumber}-receipt${receipts.length > 1 ? `-${index + 1}` : ""}.jpg`}>
                    Download
                  </a>
                  {" · "}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      setEdits((current) => {
                        const next = { ...current };
                        delete next[receipt.id];
                        return next;
                      })
                    }
                  >
                    Discard edits
                  </button>
                </>
              ) : null}
            </span>
            {onDelete ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger-soft"
                disabled={deletingId !== null}
                onClick={() => void removeReceipt(receipt)}
              >
                {deletingId === receipt.id ? "Deleting…" : "Delete"}
              </button>
            ) : null}
          </li>
          );
        })}
      </ul>
      {editingReceipt ? (
        <ReceiptEditorModal
          src={edits[editingReceipt.id]?.url ?? editingReceipt.url}
          rotation={edits[editingReceipt.id] ? 0 : (rotations[editingReceipt.id] ?? 0)}
          title={`PO ${poNumber} receipt`}
          onApply={(edited) => {
            setEdits((current) => ({ ...current, [editingReceipt.id]: edited }));
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}
