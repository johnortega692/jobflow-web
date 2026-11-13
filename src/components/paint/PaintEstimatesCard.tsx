import { useCallback, useEffect, useMemo, useState } from "react";
import { PaintProductSelect } from "./PaintFieldSelects";
import { useAuth } from "../../contexts/AuthContext";
import type { ApprovedBrushoutDraft } from "../../lib/approvedBrushouts";
import {
  getProductDisplay,
  loadPaintProducts,
  loadPaintSheens,
  sheensForPaintProduct,
  type PaintProduct,
} from "../../lib/paintCatalog";
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
  type PaintEstimateRole,
} from "../../lib/paintEstimates";

type Props = {
  projectId: string;
  jobNumber: string;
  brushoutRows: ApprovedBrushoutDraft[];
  updatedByName: string;
};

type SavedRows = Awaited<ReturnType<typeof loadPaintEstimates>>;
type Edit = { gallons: string; notes: string; adjustment: string; product?: string; sheen?: string; role?: PaintEstimateRole };

let customSeq = 0;

function isUnsavedRow(key: string): boolean {
  return key.startsWith("custom-") || key.startsWith("typed-");
}

function emptyCustomRow(typed = false): PaintEstimateDraft {
  customSeq += 1;
  return {
    key: `${typed ? "typed" : "custom"}-${customSeq}`,
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
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const { user } = useAuth();

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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadPaintProducts(user?.id, { includeHidden: true }), loadPaintSheens(user?.id)])
      .then(([nextProducts, nextSheens]) => {
        if (cancelled) return;
        setProducts(nextProducts);
        setSheens(nextSheens);
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([]);
          setSheens([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
    if (isUnsavedRow(row.key)) {
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

  function editCustom(key: string, patch: Partial<Pick<PaintEstimateDraft, "product" | "sheen" | "role">>) {
    setStatus(null);
    setCustom((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function catalogRole(productName: string): PaintEstimateRole {
    const name = productName.trim().toLowerCase();
    const match = products.find((product) => product.product.trim().toLowerCase() === name);
    return match?.is_primer ? "primer" : "custom";
  }

  function sheenChoices(row: PaintEstimateDraft): string[] {
    const options = sheensForPaintProduct(products, row.product, sheens);
    const current = row.sheen.trim();
    if (current && !options.some((option) => option.toLowerCase() === current.toLowerCase())) {
      return [current, ...options];
    }
    return options;
  }

  function setCatalogProduct(row: PaintEstimateDraft, productName: string) {
    const options = sheensForPaintProduct(products, productName, sheens);
    const kept = options.some((option) => option.toLowerCase() === row.sheen.trim().toLowerCase()) ? row.sheen : "";
    const role = catalogRole(productName);
    if (isUnsavedRow(row.key)) {
      editCustom(row.key, { product: productName, sheen: kept, role });
      return;
    }
    edit(row, { product: productName, sheen: kept, role });
  }

  function setCatalogSheen(row: PaintEstimateDraft, sheen: string) {
    if (isUnsavedRow(row.key)) {
      editCustom(row.key, { sheen });
      return;
    }
    edit(row, { sheen });
  }

  function remove(row: PaintEstimateDraft) {
    setStatus(null);
    if (isUnsavedRow(row.key)) {
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
            className="btn ghost"
            onClick={() => setCustom((prev) => [...prev, emptyCustomRow(true)])}
            disabled={busy || loading}
          >
            + Custom product
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

      <datalist id="paint-estimate-sheens">
        {sheens.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      {error && <div className="banner banner-error">{error}</div>}
      {status && !error && <div className="banner banner-ok">{status}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Add brush-out lines above, or add a catalog or custom product.</p>
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
                const isNew = isUnsavedRow(row.key);
                const isTyped = row.key.startsWith("typed-");
                const canPick = isNew || row.offList;
                const productLabel = row.product ? getProductDisplay(products, row.product) : "";
                const inCatalog = products.some(
                  (product) => product.product.trim().toLowerCase() === row.product.trim().toLowerCase(),
                );
                const showTyped = isTyped || (products.length > 0 && row.offList && !inCatalog);
                return (
                  <tr key={row.key} className={left !== null && left < 0 ? "paint-estimates-over" : undefined}>
                    <td>
                      {showTyped ? (
                        <input
                          className="input"
                          value={row.product}
                          placeholder="Custom product"
                          aria-label="Custom product"
                          onChange={(e) => edit(row, { product: e.target.value, role: "custom" })}
                        />
                      ) : canPick ? (
                        <div className="paint-estimates-product-pick">
                          <PaintProductSelect
                            value={productLabel}
                            products={products}
                            ariaLabel="Product"
                            onChange={(productName) => setCatalogProduct(row, productName)}
                          />
                          {row.role === "primer" ? <span className="paint-estimates-tag">Primer</span> : null}
                          {row.offList ? (
                            <span className="paint-estimates-tag paint-estimates-tag--muted">Not on brush-outs</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="paint-estimates-product">
                          {row.product}
                          {row.role === "primer" ? <span className="paint-estimates-tag">Primer</span> : null}
                        </span>
                      )}
                    </td>
                    <td>
                      {showTyped ? (
                        <input
                          className="input"
                          value={row.sheen}
                          placeholder="Sheen"
                          aria-label="Sheen"
                          list="paint-estimate-sheens"
                          onChange={(e) => edit(row, { sheen: e.target.value })}
                        />
                      ) : canPick ? (
                        <select
                          className="paint-field-select"
                          value={row.sheen}
                          aria-label="Sheen"
                          title={row.sheen || "Any sheen"}
                          onChange={(e) => setCatalogSheen(row, e.target.value)}
                        >
                          <option value="">Any</option>
                          {sheenChoices(row).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
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
