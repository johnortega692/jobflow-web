import { useCallback, useRef, type PointerEvent } from "react";
import type { ScanBBox } from "../types/workOrderScan";
import type { ScanBoxKind } from "../types/workOrderScan";

type Props = {
  kind: ScanBoxKind;
  bbox: ScanBBox;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (bbox: ScanBBox) => void;
};

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

const COLORS: Record<ScanBoxKind, string> = {
  ewo: "#dc2626",
  job: "#2563eb",
  date: "#059669",
};

const LABELS: Record<ScanBoxKind, string> = {
  ewo: "EWO scan",
  job: "Job scan",
  date: "Date scan",
};

function normalizeBBox(b: ScanBBox): ScanBBox {
  return {
    x1: Math.min(b.x1, b.x2),
    y1: Math.min(b.y1, b.y2),
    x2: Math.max(b.x1, b.x2),
    y2: Math.max(b.y1, b.y2),
  };
}

export function WorkOrderScanBoxLayer({ kind, bbox, scale, selected, onSelect, onChange }: Props) {
  const color = COLORS[kind];
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: ScanBBox;
  } | null>(null);

  const norm = normalizeBBox(bbox);
  const left = norm.x1 * scale;
  const top = norm.y1 * scale;
  const width = (norm.x2 - norm.x1) * scale;
  const height = (norm.y2 - norm.y1) * scale;

  const onPointerDown = useCallback(
    (e: PointerEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        orig: norm,
      };
    },
    [norm, onSelect],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      const { orig, mode } = d;
      let next: ScanBBox;

      if (mode === "move") {
        next = {
          x1: orig.x1 + dx,
          y1: orig.y1 + dy,
          x2: orig.x2 + dx,
          y2: orig.y2 + dy,
        };
      } else {
        next = { ...orig };
        if (mode.includes("n")) next.y1 = orig.y1 + dy;
        if (mode.includes("s")) next.y2 = orig.y2 + dy;
        if (mode.includes("w")) next.x1 = orig.x1 + dx;
        if (mode.includes("e")) next.x2 = orig.x2 + dx;
      }

      const w = Math.abs(next.x2 - next.x1);
      const h = Math.abs(next.y2 - next.y1);
      if (w >= 20 && h >= 12) onChange(normalizeBBox(next));
    },
    [onChange, scale],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleSize = 8;

  return (
    <div
      className={`ewo-scan-box${selected ? " ewo-scan-box-selected" : ""}`}
      style={{
        left,
        top,
        width,
        height,
        borderColor: color,
      }}
      onPointerDown={(e) => onPointerDown(e, "move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <span className="ewo-scan-box-label" style={{ color }}>
        {LABELS[kind]}
      </span>
      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
        <div
          key={corner}
          className={`ewo-scan-handle ewo-scan-handle-${corner}`}
          style={{ background: color, width: handleSize, height: handleSize }}
          onPointerDown={(e) => onPointerDown(e, corner)}
        />
      ))}
    </div>
  );
}
