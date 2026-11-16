import { useEffect, useMemo, useState } from "react";
import { listProjectBrushouts } from "../../lib/approvedBrushouts";
import {
  lastMinPaintFormRows,
  lastMinPaintGallons,
  listPaintEstimateNames,
  parseLastMinPaintGallons,
  saveLastMinPaint,
  type LastMinPaintFormRow,
} from "../../lib/paintEstimates";

type Props = {
  orderId: string;
  projectId: string;
  payload: Record<string, unknown>;
  canEdit: boolean;
  onSaved: (lines: unknown[]) => void;
};

function rowLabel(row: LastMinPaintFormRow): string {
  return [row.product, row.sheen].filter(Boolean).join(" · ");
}

export function LastMinPaintEditor({ orderId, projectId, payload, canEdit, onSaved }: Props) {
  const [rows, setRows] = useState<LastMinPaintFormRow[]>([]);
  const [gallons, setGallons] = useState<Record<string, string>>({});
  const [savedGallons, setSavedGallons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([listProjectBrushouts(projectId), listPaintEstimateNames(projectId).catch(() => [])])
      .then(([brushouts, names]) => {
        if (cancelled) return;
        const nextRows = lastMinPaintFormRows(brushouts, names, payload);
        const nextGallons = lastMinPaintGallons(payload);
        setRows(nextRows);
        setGallons(nextGallons);
        setSavedGallons(nextGallons);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load paint products.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Reload when the saved receipt paint changes, not on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, projectId, JSON.stringify(lastMinPaintGallons(payload))]);

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(gallons), ...Object.keys(savedGallons)]);
    for (const key of keys) {
      if ((gallons[key] ?? "").trim() !== (savedGallons[key] ?? "").trim()) return true;
    }
    return false;
  }, [gallons, savedGallons]);

  async function onSave() {
    const lines: { product: string; sheen: string; gallons: number }[] = [];
    for (const row of rows) {
      const text = (gallons[row.key] ?? "").trim();
      if (!text || Number(text) === 0) continue;
      const value = parseLastMinPaintGallons(text);
      if (value === null) {
        setError(`Enter gallons as a number for ${row.product}.`);
        setStatus(null);
        return;
      }
      lines.push({ product: row.product, sheen: row.sheen, gallons: value });
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await saveLastMinPaint(orderId, lines);
      const nextGallons: Record<string, string> = {};
      for (const line of lines) {
        const row = rows.find((item) => item.product === line.product && item.sheen === line.sheen);
        if (row) nextGallons[row.key] = String(line.gallons);
      }
      setGallons(nextGallons);
      setSavedGallons(nextGallons);
      onSaved(saved);
      setStatus(lines.length ? "Paint gallons saved. They count on the paint estimate." : "Paint gallons cleared.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save paint.");
    } finally {
      setBusy(false);
    }
  }

  const visibleRows = canEdit ? rows : rows.filter((row) => (savedGallons[row.key] ?? "").trim());

  return (
    <div className="field-tools-order-cart" id="last-min-paint">
      <p className="field-tools-order-cart-title">Paint on this receipt</p>
      <p className="muted small">
        Gallons count toward the job&apos;s paint estimate. The receipt amount still counts on the material budget.
      </p>
      {loading ? <p className="muted small">Loading paint products…</p> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}
      {!loading && visibleRows.length === 0 ? (
        <p className="muted small">
          {canEdit
            ? "This job has no approved brush-outs yet, so there's no paint to enter."
            : "No paint gallons on this receipt."}
        </p>
      ) : null}
      {visibleRows.length > 0 ? (
        <div className="last-min-paint-list">
          {visibleRows.map((row) => {
            const inputId = `last-min-gal-${row.key}`;
            return (
              <div key={row.key} className="last-min-paint-row">
                <label htmlFor={inputId}>
                  <span>{rowLabel(row)}</span>
                  {row.primer ? <span className="last-min-paint-primer">Primer</span> : null}
                </label>
                {canEdit ? (
                  <input
                    id={inputId}
                    className="input"
                    inputMode="decimal"
                    value={gallons[row.key] ?? ""}
                    placeholder="0"
                    aria-label={`Gallons of ${rowLabel(row)}`}
                    disabled={busy}
                    onChange={(e) => {
                      setGallons((current) => ({ ...current, [row.key]: e.target.value }));
                      setStatus(null);
                    }}
                  />
                ) : (
                  <span>{savedGallons[row.key]} gal</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {canEdit && visibleRows.length > 0 ? (
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void onSave()}>
            {busy ? "Saving…" : "Save paint"}
          </button>
          {status ? <p className="muted small">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
