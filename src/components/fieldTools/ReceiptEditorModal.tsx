import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

export type EditedReceipt = { url: string; w: number; h: number };

type Point = { x: number; y: number };
type Stroke = { color: string; width: number; points: Point[] };
type Rect = { x: number; y: number; w: number; h: number };
type Mode = "crop" | "draw";

const PEN_COLORS = [
  { id: "#e53935", label: "Red" },
  { id: "#1e63d6", label: "Blue" },
  { id: "#111111", label: "Black" },
  { id: "#2e9d4f", label: "Green" },
];

type Props = {
  /** Original receipt URL, or the current edited version to keep working on it. */
  src: string;
  /** Rotation already applied in the viewer; baked into the editing canvas. */
  rotation: 0 | 90 | 180 | 270;
  title: string;
  onApply: (edited: EditedReceipt) => void;
  onClose: () => void;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open this photo for editing."));
    img.src = src;
  });
}

function rotatedCanvas(img: HTMLImageElement, rotation: number): HTMLCanvasElement {
  const sideways = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = sideways ? img.naturalHeight : img.naturalWidth;
  canvas.height = sideways ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0]!.x + 0.01, stroke.points[0]!.y);
    ctx.stroke();
  }
}

function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Rotate an already-edited (same-origin) image by a quarter turn. */
export async function rotateEditedReceipt(edited: EditedReceipt, delta: 90 | -90): Promise<EditedReceipt> {
  const img = await loadImage(edited.url);
  const canvas = rotatedCanvas(img, (delta + 360) % 360);
  return { url: canvas.toDataURL("image/jpeg", 0.92), w: canvas.width, h: canvas.height };
}

export function ReceiptEditorModal({ src, rotation, title, onApply, onClose }: Props) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("crop");
  const [color, setColor] = useState(PEN_COLORS[0]!.id);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const cropStart = useRef<Point | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(src)
      .then((img) => {
        if (!cancelled) setBase(rotatedCanvas(img, rotation));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not open this photo for editing.");
      });
    return () => {
      cancelled = true;
    };
  }, [src, rotation]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const penWidth = base ? Math.max(3, Math.round(Math.max(base.width, base.height) / 300)) : 4;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !base) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    drawStrokes(ctx, activeStroke.current ? [...strokes, activeStroke.current] : strokes);
    if (crop && crop.w > 0 && crop.h > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.rect(0, 0, base.width, base.height);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, penWidth / 2);
      ctx.setLineDash([penWidth * 3, penWidth * 2]);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.restore();
    }
  }, [base, strokes, crop, penWidth]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function toImagePoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x: Math.min(canvas.width, Math.max(0, x)), y: Math.min(canvas.height, Math.max(0, y)) };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!base || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toImagePoint(event);
    if (mode === "draw") {
      activeStroke.current = { color, width: penWidth, points: [point] };
    } else {
      cropStart.current = point;
      setCrop({ x: point.x, y: point.y, w: 0, h: 0 });
    }
    redraw();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (mode === "draw" && activeStroke.current) {
      activeStroke.current.points.push(toImagePoint(event));
      redraw();
    } else if (mode === "crop" && cropStart.current) {
      setCrop(normalizeRect(cropStart.current, toImagePoint(event)));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (activeStroke.current) {
      const finished = activeStroke.current;
      activeStroke.current = null;
      setStrokes((current) => [...current, finished]);
    }
    if (cropStart.current) {
      cropStart.current = null;
      setCrop((current) => (current && current.w > 8 && current.h > 8 ? current : null));
    }
  }

  function apply() {
    if (!base) return;
    const area = crop && crop.w > 8 && crop.h > 8 ? crop : { x: 0, y: 0, w: base.width, h: base.height };
    const out = document.createElement("canvas");
    out.width = Math.round(area.w);
    out.height = Math.round(area.h);
    const ctx = out.getContext("2d")!;
    ctx.translate(-area.x, -area.y);
    ctx.drawImage(base, 0, 0);
    drawStrokes(ctx, strokes);
    try {
      onApply({ url: out.toDataURL("image/jpeg", 0.92), w: out.width, h: out.height });
    } catch {
      setApplyError("This photo can't be edited in the browser. Print the original instead.");
    }
  }

  const dirty = strokes.length > 0 || crop != null;

  return createPortal(
    <div className="modal-backdrop receipt-editor-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card receipt-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="receipt-editor-toolbar">
          <div className="receipt-editor-modes" role="group" aria-label="Edit mode">
            <button
              type="button"
              className={`btn btn-sm ${mode === "crop" ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={mode === "crop"}
              onClick={() => setMode("crop")}
            >
              Crop
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === "draw" ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={mode === "draw"}
              onClick={() => setMode("draw")}
            >
              Draw
            </button>
          </div>
          {mode === "draw" ? (
            <div className="receipt-editor-colors" role="group" aria-label="Pen color">
              {PEN_COLORS.map((pen) => (
                <button
                  key={pen.id}
                  type="button"
                  className={`receipt-editor-swatch${color === pen.id ? " is-active" : ""}`}
                  style={{ background: pen.id }}
                  aria-label={`${pen.label} pen`}
                  aria-pressed={color === pen.id}
                  onClick={() => setColor(pen.id)}
                />
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!strokes.length}
                onClick={() => setStrokes((current) => current.slice(0, -1))}
              >
                Undo
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!strokes.length} onClick={() => setStrokes([])}>
                Clear
              </button>
            </div>
          ) : (
            <div className="receipt-editor-colors">
              <span className="muted small">Drag a box around the part to keep.</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!crop} onClick={() => setCrop(null)}>
                Reset crop
              </button>
            </div>
          )}
        </div>

        {loadError || applyError ? (
          <div className="banner banner-error" role="alert">
            {loadError ?? applyError}
          </div>
        ) : null}

        <div className="receipt-editor-stage">
          {base ? (
            <canvas
              ref={canvasRef}
              className={`receipt-editor-canvas receipt-editor-canvas--${mode}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ) : loadError ? null : (
            <p className="muted">Loading photo…</p>
          )}
        </div>

        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" disabled={!base || !dirty} onClick={apply}>
            Apply
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <span className="muted small receipt-editor-note">Edits are for printing and downloading. The saved receipt photo stays the same.</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
