import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovedBrushoutDraft } from "../../lib/approvedBrushouts";
import {
  gallonsLabel,
  lastMinUncountedLabel,
  loadLastMinUncounted,
  loadPaintEstimates,
  mergePaintEstimates,
  parseAdjustmentGallons,
  parseEstimateGallons,
  savePaintEstimates,
  type LastMinUncounted,
  type PaintEstimateDraft,
} from "../../lib/paintEstimates";

type Props = {
  projectId: string;
  jobNumber: string;
  brushoutRows: ApprovedBrushoutDraft[];
  updatedByName: string;
};

type SavedRows = Awaited<ReturnType<typeof loadPaintEstimates>>;
type Edit = { gallons: string; notes: string; adjustment: string };

let customSeq = 0;

function emptyCustomRow(): PaintEstimateDraft {
  customSeq += 1;
  return {
    key: `custom-${customSeq}`,
    product: "",
    sheen: "",
    role: "custom",
    gallons: "",
    notes: "",
    adjustment: "",
    orderedGallons: 0,
    offList: false,
  };
}

export function PaintEstimatesCard({ projectId, jobNumber, brushoutRows, updatedByName }: Props) {
  const [saved, setSaved] = useState<SavedRows>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [custom, setCustom] = useState<PaintEstimateDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastMin, setLastMin] = useState<LastMinUncounted>({ count: 0, amount: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [estimates, uncounted] = await Promise.all([
        loadPaintEstimates(projectId, jobNumber),
        loadLastMinUncounted(jobNumber).catch(() => ({ count: 0, amount: 0 })),
      ]);
      setSaved(estimates);
      setLastMin(uncounted);
      setEdits({});
      setRemoved(new Set());
      setCustom([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load estimates");
    } finally {
      setLoading(false);
    }
  }, [projectId, jobNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const merged = mergePaintEstimates(brushoutRows, saved)
      .filter((row) => !removed.has(row.key))
      .map((row) => (edits[row.key] ? { ...row, ...edits[row.key] } : row));
    return [...merged, ...custom];
  }, [brushoutRows, saved, edits, removed, custom]);

  const dirty = Object.keys(edits).length > 0 || removed.size > 0 || custom.length > 0;
  const totals = useMemo(() => {
    let estimated = 0;
    let ordered = 0;
    let adjustment = 0;
    for (const row of rows) {
      const gallons = parseEstimateGallons(row.gallons);
      const extra = parseAdjustmentGallons(row.adjustment) ?? 0;
      adjustment += extra;
      if (gallons === null) continue;
      estimated += gallons;
      ordered += row.orderedGallons;
    }
    return { estimated, ordered, adjustment };
  }, [rows]);

  function edit(row: PaintEstimateDraft, patch: Partial<Edit>) {
    setStatus(null);
    if (row.key.startsWith("custom-")) {
      setCustom((prev) => prev.map((item) => (item.key === row.key ? { ...item, ...patch } : item)));
      return;
    }
    setEdits((prev) => ({
      ...prev,
      [row.key]: {
        ...(prev[row.key] ?? { gallons: row.gallons, notes: row.notes, adjustment: row.adjustment }),
        ...patch,
      },
    }));
  }

  function editCustom(key: string, patch: Partial<Pick<PaintEstimateDraft, "product" | "sheen">>) {
    setStatus(null);
    setCustom((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function remove(row: PaintEstimateDraft) {
    setStatus(null);
    if (row.key.startsWith("custom-")) {
      setCustom((prev) => prev.filter((item) => item.key !== row.key));
      return;
    }
    setRemoved((prev) => new Set(prev).add(row.key));
  }

  async function onSave() {
    const bad = rows.find((row) => row.gallons.trim() && parseEstimateGallons(row.gallons) === null);
    if (bad) {
      setError(`Enter gallons as a number for ${bad.product || "the new product"}.`);
      return;
    }
    const badAdjustment = rows.find((row) => parseAdjustmentGallons(row.adjustment) === null);
    if (badAdjustment) {
      setError(`Enter the adjustment as a number for ${badAdjustment.product || "the new product"}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savePaintEstimates(projectId, jobNumber, rows, updatedByName);
      await load();
      setStatus("Estimates saved. Admin and super see them while ordering when Paint estimates is on.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack paint-estimates-card">
      <div className="row-between wrap gap">
        <div className="stack gap-xs">
          <h3>Estimated quantities</h3>
          <p className="muted small">
            Gallons per product and sheen. Ordered counts Field Tools field orders, PM orders, and last-min receipts
            with paint on job {jobNumber || "—"}. Adjust adds gallons bought outside the app and does not use a PO
            number.
          </p>
          {lastMin.count > 0 ? (
            <p className="small paint-estimates-lastmin">{lastMinUncountedLabel(lastMin, jobNumber)}</p>
          ) : null}
        </div>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setCustom((prev) => [...prev, emptyCustomRow()])}
            disabled={busy || loading}
          >
            + Add product
          </button>
          <button
            type="button"
            className={`btn${dirty ? " btn-primary" : " btn-secondary"}`}
            onClick={() => void onSave()}
            disabled={busy || loading || !dirty}
          >
            {busy ? "Saving…" : "Save estimates"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && !error && <div className="banner banner-ok">{status}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Add brush-out lines above, or use + Add product.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table paint-estimates-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Sheen</th>
                <th className="paint-estimates-num">Estimate (gal)</th>
                <th className="paint-estimates-num">Ordered</th>
                <th className="paint-estimates-num">Adjust</th>
                <th className="paint-estimates-num">Left</th>
                <th>Notes</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const estimate = parseEstimateGallons(row.gallons);
                const adjustment = parseAdjustmentGallons(row.adjustment) ?? 0;
                const left = estimate === null ? null : estimate - row.orderedGallons - adjustment;
                const isNew = row.key.startsWith("custom-");
                return (
                  <tr key={row.key} className={left !== null && left < 0 ? "paint-estimates-over" : undefined}>
                    <td>
                      {isNew ? (
                        <input
                          className="input"
                          value={row.product}
                          placeholder="Product"
                          aria-label="Product"
                          onChange={(e) => editCustom(row.key, { product: e.target.value })}
                        />
                      ) : (
                        <span className="paint-estimates-product">
                          {row.product}
                          {row.role === "primer" ? <span className="paint-estimates-tag">Primer</span> : null}
                          {row.offList ? (
                            <span className="paint-estimates-tag paint-estimates-tag--muted">Not on brush-outs</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td>
                      {isNew ? (
                        <input
                          className="input"
                          value={row.sheen}
                          placeholder="Sheen"
                          aria-label="Sheen"
                          onChange={(e) => editCustom(row.key, { sheen: e.target.value })}
                        />
                      ) : (
                        row.sheen || <span className="muted">Any</span>
                      )}
                    </td>
                    <td className="paint-estimates-num">
                      <input
                        className="input paint-estimates-input"
                        inputMode="decimal"
                        value={row.gallons}
                        placeholder="—"
                        aria-label={`Estimated gallons for ${row.product} ${row.sheen}`.trim()}
                        onChange={(e) => edit(row, { gallons: e.target.value })}
                      />
                    </td>
                    <td className="paint-estimates-num">{gallonsLabel(row.orderedGallons)}</td>
                    <td className="paint-estimates-num">
                      <input
                        className="input paint-estimates-input"
                        inputMode="decimal"
                        value={row.adjustment}
                        placeholder="0"
                        title="Gallons ordered outside Field Tools. Use a negative number to subtract."
                        aria-label={`Adjustment gallons for ${row.product} ${row.sheen}`.trim()}
                        onChange={(e) => edit(row, { adjustment: e.target.value })}
                      />
                    </td>
                    <td className="paint-estimates-num">
                      {left === null ? (
                        <span className="muted">—</span>
                      ) : left < 0 ? (
                        <span className="paint-estimates-over-text">{gallonsLabel(-left)} over</span>
                      ) : (
                        gallonsLabel(left)
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        value={row.notes}
                        aria-label={`Notes for ${row.product}`}
                        onChange={(e) => edit(row, { notes: e.target.value })}
                      />
                    </td>
                    <td>
                      {isNew || row.offList ? (
                        <button
                          type="button"
                          className="btn ghost btn-sm"
                          aria-label={`Remove ${row.product || "row"}`}
                          onClick={() => remove(row)}
                        >
                          ×
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="paint-estimates-num">{gallonsLabel(totals.estimated)}</td>
                <td className="paint-estimates-num">{gallonsLabel(totals.ordered)}</td>
                <td className="paint-estimates-num">{gallonsLabel(totals.adjustment)}</td>
                <td className="paint-estimates-num">
                  {totals.estimated - totals.ordered - totals.adjustment < 0
                    ? `${gallonsLabel(totals.ordered + totals.adjustment - totals.estimated)} over`
                    : gallonsLabel(totals.estimated - totals.ordered - totals.adjustment)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
