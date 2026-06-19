import { useEffect, useState } from "react";
import { bucketLabel, parseMoney, type LineSplitPart } from "../../lib/budgetMakerCore";
import type { BudgetBucket, BudgetLibrary, BudgetScanLine } from "../../types/budgetMaker";

type SplitRow = {
  bucketIdx: number;
  amount: string;
  hours: string;
};

type Props = {
  line: BudgetScanLine;
  buckets: BudgetBucket[];
  library: BudgetLibrary;
  onClose: () => void;
  onSplit: (splits: LineSplitPart[]) => void;
};

function parseHours(text: string): number {
  const t = text.trim().replace(/,/g, "");
  if (!t) return 0;
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

export function BudgetSplitLineModal({ line, buckets, library, onClose, onSplit }: Props) {
  const origAmount = line.Amount ?? 0;
  const origHours = line["Man Hours"] ?? 0;
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const startCount = buckets.length >= 2 ? 2 : 1;
    const initial: SplitRow[] = Array.from({ length: startCount }, (_, i) => ({
      bucketIdx: i,
      amount: "",
      hours: "",
    }));
    setRows(splitEvenly(initial, origAmount, origHours));
    // Initialize split rows once when dialog opens for this line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id]);

  function splitEvenly(current: SplitRow[], amount: number, hours: number): SplitRow[] {
    const n = current.length || 1;
    const amtEach = amount / n;
    const hrsEach = hours / n;
    return current.map((_, i) => ({
      bucketIdx: i < buckets.length ? i : 0,
      amount: amtEach ? amtEach.toFixed(2) : "",
      hours: hrsEach ? hrsEach.toFixed(1) : "",
    }));
  }

  function updateRow(index: number, patch: Partial<SplitRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { bucketIdx: 0, amount: "", hours: "" }]);
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const amountUsed = rows.reduce((s, r) => s + (parseMoney(r.amount) ?? 0), 0);
  const hoursUsed = rows.reduce((s, r) => s + parseHours(r.hours), 0);
  const amountLeft = origAmount - amountUsed;
  const hoursLeft = origHours - hoursUsed;

  function submit() {
    const splits: LineSplitPart[] = [];
    let totalAmt = 0;
    let totalHrs = 0;
    for (const row of rows) {
      const amount = parseMoney(row.amount) ?? 0;
      const hours = parseHours(row.hours);
      if (amount === 0 && hours === 0) {
        setError("Each row needs an amount or hours.");
        return;
      }
      splits.push({ bucket_idx: row.bucketIdx, amount, hours });
      totalAmt += amount;
      totalHrs += hours;
    }
    if (Math.abs(totalAmt - origAmount) > 0.02) {
      setError(`Amounts must total $${origAmount.toFixed(2)} (currently $${totalAmt.toFixed(2)}).`);
      return;
    }
    if (origHours > 0 && Math.abs(totalHrs - origHours) > 0.05) {
      setError(`Hours must total ${origHours.toFixed(1)} (currently ${totalHrs.toFixed(1)}).`);
      return;
    }
    onSplit(splits);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack budget-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Split line to buckets</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="card stack budget-split-line-info">
          <strong>{line.Description}</strong>
          <span className="muted small">
            Code {line["PDF Code"]} · {line.Category} · Amount ${origAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {origHours ? ` · Hours ${origHours.toFixed(1)}` : ""}
          </span>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="row-gap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
            + Add bucket
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRows((prev) => splitEvenly(prev, origAmount, origHours))}
          >
            Split evenly
          </button>
        </div>

        <div className="stack budget-split-rows">
          {rows.map((row, i) => (
            <div key={i} className="row-gap wrap budget-split-row">
              <label className="budget-inline-label">
                Bucket
                <select
                  value={String(row.bucketIdx)}
                  onChange={(e) => updateRow(i, { bucketIdx: parseInt(e.target.value, 10) })}
                >
                  {buckets.map((b, bi) => (
                    <option key={bi} value={String(bi)}>
                      {bucketLabel(b, bi, library)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input value={row.amount} onChange={(e) => updateRow(i, { amount: e.target.value })} inputMode="decimal" />
              </label>
              <label>
                Hours
                <input value={row.hours} onChange={(e) => updateRow(i, { hours: e.target.value })} inputMode="decimal" />
              </label>
              {rows.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="muted small">
          Remaining amount: ${amountLeft.toFixed(2)}
          {origHours > 0 ? ` · hours: ${hoursLeft.toFixed(1)}` : ""}
        </p>

        <div className="row-between">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Split
          </button>
        </div>
      </div>
    </div>
  );
}
