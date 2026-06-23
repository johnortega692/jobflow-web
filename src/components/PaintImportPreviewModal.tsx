import { useEffect, useRef, useState } from "react";
import type { ExtractedPaintRow } from "../lib/paintImageImport";

type Props = {
  rows: ExtractedPaintRow[];
  imageUrl: string;
  onConfirm: (rows: ExtractedPaintRow[]) => void;
  onCancel: () => void;
};

const ZOOM = 2.5;
const LENS_SIZE = 168;

function ImageMagnifier({ src, alt }: { src: string; alt: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const sync = () => setSize({ w: img.clientWidth, h: img.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(img);
    return () => ro.disconnect();
  }, [src]);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setPos({ x, y });
    setActive(true);
  }

  const bgW = size.w * ZOOM;
  const bgH = size.h * ZOOM;
  const bgX = -pos.x * ZOOM + LENS_SIZE / 2;
  const bgY = -pos.y * ZOOM + LENS_SIZE / 2;

  return (
    <div
      ref={wrapRef}
      className="paint-import-magnifier-wrap"
      onMouseMove={onMove}
      onMouseLeave={() => setActive(false)}
    >
      <img ref={imgRef} src={src} alt={alt} className="paint-import-preview-img" draggable={false} />
      {active && size.w > 0 ? (
        <div
          className="paint-import-magnifier-lens"
          style={{
            left: pos.x - LENS_SIZE / 2,
            top: pos.y - LENS_SIZE / 2,
            width: LENS_SIZE,
            height: LENS_SIZE,
            backgroundImage: `url(${src})`,
            backgroundSize: `${bgW}px ${bgH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
          }}
          aria-hidden
        />
      ) : null}
      <p className="muted small paint-import-magnifier-hint">Hover to magnify</p>
    </div>
  );
}

export function PaintImportPreviewModal({ rows: initialRows, imageUrl, onConfirm, onCancel }: Props) {
  const [rows, setRows] = useState<ExtractedPaintRow[]>(() => initialRows.map((r) => ({ ...r })));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function patchRow(index: number, patch: Partial<ExtractedPaintRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal card stack paint-import-preview-modal"
        role="dialog"
        aria-labelledby="paint-import-preview-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap paint-import-preview-header">
          <div>
            <h3 id="paint-import-preview-title">Review AI import</h3>
            <p className="muted small">
              Check the source image and extracted rows. Edit or remove anything wrong, then add to the
              paint list.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="paint-import-preview-body">
          <div className="paint-import-preview-image-col">
            <ImageMagnifier src={imageUrl} alt="Imported paint schedule" />
          </div>

          <div className="paint-import-preview-table-col">
            <p className="small paint-import-preview-count">
              <strong>{rows.length}</strong> item{rows.length === 1 ? "" : "s"} found
            </p>
            <div className="paint-import-preview-table-wrap">
              <table className="paint-settings-table paint-import-preview-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Mfr</th>
                    <th>Color</th>
                    <th>Product</th>
                    <th>Sheen</th>
                    <th>Floor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted small">
                        All rows removed — cancel or paste/import again.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr key={`import-row-${i}`}>
                        <td>
                          <input value={row.label} onChange={(e) => patchRow(i, { label: e.target.value })} />
                        </td>
                        <td>
                          <input
                            value={row.manufacturer}
                            onChange={(e) => patchRow(i, { manufacturer: e.target.value })}
                          />
                        </td>
                        <td>
                          <input value={row.color} onChange={(e) => patchRow(i, { color: e.target.value })} />
                        </td>
                        <td>
                          <input value={row.product} onChange={(e) => patchRow(i, { product: e.target.value })} />
                        </td>
                        <td>
                          <input value={row.sheen} onChange={(e) => patchRow(i, { sheen: e.target.value })} />
                        </td>
                        <td>
                          <input value={row.floor} onChange={(e) => patchRow(i, { floor: e.target.value })} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Remove row"
                            onClick={() => removeRow(i)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="row-gap wrap paint-import-preview-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!rows.length}
            onClick={() => onConfirm(rows.filter((r) => r.label.trim()))}
          >
            Add {rows.filter((r) => r.label.trim()).length} item
            {rows.filter((r) => r.label.trim()).length === 1 ? "" : "s"} to list
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
