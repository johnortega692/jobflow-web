import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { browserTextWidth, layoutOverlaySegments, overlaySegments, spacingForOverlay, type WorkOrderTextSpacing } from "../../lib/workOrderOverlayLayout";
import { TOTAL_LABEL_AMOUNT_GAP, isTotalRowVisible } from "../../lib/workOrderTotalPositions";
import type { WorkOrderDisplayPrefs } from "../../types/workOrder";
import type { WorkOrderOverlay } from "../../types/workOrder";
import type { ScanBBox, ScanBoxKind, WorkOrderScanBoxes } from "../../types/workOrderScan";
import { WorkOrderScanBoxLayer } from "./WorkOrderScanBoxLayer";

type Props = {
  backgroundUrl: string | null;
  pageWidth: number;
  pageHeight: number;
  overlays: WorkOrderOverlay[];
  display: WorkOrderDisplayPrefs;
  textSpacing: WorkOrderTextSpacing;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  scanBoxes: WorkOrderScanBoxes;
  showScanBoxes: boolean;
  selectedScanBox: ScanBoxKind | null;
  onSelectScanBox: (kind: ScanBoxKind | null) => void;
  onScanBoxChange: (kind: ScanBoxKind, bbox: ScanBBox) => void;
  scanSetupHint?: string | null;
};

const BASE_DISPLAY_WIDTH = 630;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
}

export function WorkOrderCanvas({
  backgroundUrl,
  pageWidth,
  pageHeight,
  overlays,
  display,
  textSpacing,
  selectedId,
  onSelect,
  onMove,
  scanBoxes,
  showScanBoxes,
  selectedScanBox,
  onSelectScanBox,
  onScanBoxChange,
  scanSetupHint,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayWidth = BASE_DISPLAY_WIDTH * zoom;
  const scale = displayWidth / pageWidth;
  const displayHeight = pageHeight * scale;
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent, o: WorkOrderOverlay) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectScanBox(null);
      onSelect(o.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        id: o.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: o.x,
        origY: o.y,
      };
      setDraggingId(o.id);
    },
    [onSelect, onSelectScanBox],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      onMove(d.id, Math.max(0, d.origX + dx), Math.max(0, d.origY + dy));
    },
    [onMove, scale],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
  }, []);

  if (!backgroundUrl) {
    return (
      <div className="ewo-canvas-empty">
        <p className="muted">Upload a work order PDF or image to begin placing text overlays.</p>
      </div>
    );
  }

  return (
    <div className="ewo-canvas-wrap">
      <div className="ewo-canvas-toolbar row-between wrap">
        <span className="muted small">Ctrl + scroll to zoom</span>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="ewo-canvas-zoom-label muted small">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={zoom === 1}
            onClick={() => setZoom(1)}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="ewo-canvas-scroll" ref={scrollRef}>
      {scanSetupHint && (
        <div className="ewo-canvas-setup-hint" role="status">
          {scanSetupHint}
        </div>
      )}
      <div
        className="ewo-canvas-stage"
        style={{ width: displayWidth, height: displayHeight }}
        onClick={() => {
          onSelect(null);
          onSelectScanBox(null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <img
          src={backgroundUrl}
          alt="Work order background"
          className="ewo-canvas-bg"
          draggable={false}
          width={displayWidth}
          height={displayHeight}
        />
        {showScanBoxes && scanBoxes.ewo && (
          <WorkOrderScanBoxLayer
            kind="ewo"
            bbox={scanBoxes.ewo}
            scale={scale}
            selected={selectedScanBox === "ewo"}
            onSelect={() => {
              onSelect(null);
              onSelectScanBox("ewo");
            }}
            onChange={(bbox) => onScanBoxChange("ewo", bbox)}
          />
        )}
        {showScanBoxes && scanBoxes.job && (
          <WorkOrderScanBoxLayer
            kind="job"
            bbox={scanBoxes.job}
            scale={scale}
            selected={selectedScanBox === "job"}
            onSelect={() => {
              onSelect(null);
              onSelectScanBox("job");
            }}
            onChange={(bbox) => onScanBoxChange("job", bbox)}
          />
        )}
        {showScanBoxes && scanBoxes.date && (
          <WorkOrderScanBoxLayer
            kind="date"
            bbox={scanBoxes.date}
            scale={scale}
            selected={selectedScanBox === "date"}
            onSelect={() => {
              onSelect(null);
              onSelectScanBox("date");
            }}
            onChange={(bbox) => onScanBoxChange("date", bbox)}
          />
        )}
        {overlays.map((o) => {
          if (o.section === "total" && !isTotalRowVisible(o.label, display)) return null;
          const isTotal = o.section === "total";
          const totalGap = TOTAL_LABEL_AMOUNT_GAP * scale;
          const rowGap = spacingForOverlay(o, textSpacing);
          const segments = isTotal ? [] : overlaySegments(o, display);
          const spaced =
            !isTotal && segments.length
              ? layoutOverlaySegments(segments, rowGap, o.font_size)
              : null;
          const totalWidth = isTotal
            ? (TOTAL_LABEL_AMOUNT_GAP + browserTextWidth(o.amount, o.font_size)) * scale
            : undefined;
          return (
            <div
              key={o.id}
              className={`ewo-overlay${isTotal ? " ewo-overlay-total" : " ewo-overlay-spaced"}${selectedId === o.id ? " ewo-overlay-selected" : ""}${draggingId === o.id ? " ewo-overlay-dragging" : ""}`}
              style={{
                left: o.x * scale,
                top: o.y * scale,
                color: o.color,
                fontSize: o.font_size * scale,
                ...(spaced ? { width: spaced.width * scale } : {}),
                ...(totalWidth != null ? { width: totalWidth } : {}),
              }}
              onPointerDown={(e) => onPointerDown(e, o)}
            >
              {isTotal ? (
                <span className="ewo-total-row">
                  {display.show_total_labels && (
                    <span className="ewo-total-label">{o.label}</span>
                  )}
                  <span className="ewo-total-amount" style={{ left: totalGap }}>
                    {o.amount}
                  </span>
                </span>
              ) : (
                <span className="ewo-spaced-row">
                  {spaced?.segments.map((seg, i) => (
                    <span
                      key={i}
                      className="ewo-spaced-segment"
                      style={{ left: spaced.offsets[i] * scale }}
                    >
                      {seg.text}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
