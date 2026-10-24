import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OrderReceiptImage } from "../../lib/fieldToolsPoTracker";
import { esc, printHtml } from "../../lib/printCore";

type Props = {
  receipts: OrderReceiptImage[];
  poNumber: string;
  onDelete?: (receiptId: string) => Promise<void>;
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

function printReceipts(poNumber: string, receipts: OrderReceiptImage[]): void {
  const title = `PO ${poNumber} receipt`;
  const sheets = receipts
    .map(
      (receipt) => `<section class="sheet">
        <h1>PO# ${esc(poNumber)}</h1>
        <img src="${esc(receipt.url)}" alt="Receipt for PO ${esc(poNumber)}" />
      </section>`,
    )
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
    img { max-width: 100%; max-height: calc(100vh - 36px); object-fit: contain; }
  </style>
</head>
<body>${sheets}</body>
</html>`;
  printHtml(html, title);
}

export function ReceiptImageViewer({ receipts, poNumber, onDelete }: Props) {
  const [zoom, setZoom] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => printReceipts(poNumber, receipts)}
        >
          Print
        </button>
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
        {receipts.map((receipt) => (
          <img
            key={receipt.id}
            src={receipt.url}
            alt={`Receipt for PO ${poNumber}`}
            className="receipt-zoom-img"
            style={{ width: `${zoom * 100}%` }}
            draggable={false}
          />
        ))}
      </div>
      {deleteError && <div className="banner banner-error">{deleteError}</div>}
      <ul className="receipt-zoom-meta">
        {receipts.map((receipt) => (
          <li key={receipt.id} className="receipt-zoom-meta-row muted small">
            <span>
              {formatUploadedAt(receipt.createdAt)}
              {receipt.uploadedBy ? ` · ${receipt.uploadedBy}` : ""}
              {" · "}
              <a href={receipt.url} target="_blank" rel="noreferrer">
                Open full size
              </a>
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
        ))}
      </ul>
    </div>
  );
}
