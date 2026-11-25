import { useEffect, useState } from "react";
import { formatMaterialDollars } from "../../lib/materialOrderSpend";
import { listFieldOrderTotals, parseLastMinAmount, saveFieldOrderInvoice, type FieldOrderMoney } from "../../lib/fieldToolsPoTracker";

type Props = {
  orderId: string;
  jobNumber: string;
  canEdit: boolean;
  onSaved: (money: FieldOrderMoney) => void;
};

export function FieldOrderInvoiceEditor({ orderId, jobNumber, canEdit, onSaved }: Props) {
  const [money, setMoney] = useState<FieldOrderMoney | null>(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listFieldOrderTotals(jobNumber)
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((item) => item.orderId === orderId) ?? null;
        setMoney(row);
        setAmount(row ? (row.invoice ?? row.placed).toFixed(2) : "");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the order total.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobNumber, orderId]);

  const saved = money ? (money.invoice ?? money.placed).toFixed(2) : "";
  const dirty = amount.trim() !== saved;

  async function onSave() {
    const value = parseLastMinAmount(amount);
    if (value == null || !money) {
      setError("Enter the invoice amount, like 119.63.");
      setStatus(null);
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const savedAmount = await saveFieldOrderInvoice(orderId, value);
      const next: FieldOrderMoney = { ...money, invoice: Number(savedAmount) };
      setMoney(next);
      setAmount(savedAmount);
      onSaved(next);
      setStatus("Invoice saved. It replaces this order on the material budget.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-tools-order-cart" id="field-order-invoice">
      <p className="field-tools-order-cart-title">Order total</p>
      <p className="muted small">
        Order placed is the catalog total for this order, with sales tax. The invoice amount replaces it on the material budget.
      </p>
      {loading ? <p className="muted small">Loading order total…</p> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}
      {money ? (
        <>
          <div className="last-min-paint-row">
            <span>Order placed</span>
            <strong>{formatMaterialDollars(money.placed)}</strong>
          </div>
          {money.unpriced > 0 ? (
            <p className="muted small">
              {money.unpriced} item{money.unpriced === 1 ? "" : "s"} {money.unpriced === 1 ? "has" : "have"} no catalog price, so {money.unpriced === 1 ? "it is" : "they are"} not in Order placed.
            </p>
          ) : null}
          {canEdit ? (
            <div className="last-min-paint-row">
              <label htmlFor="field-order-invoice-input">Invoice amount</label>
              <input
                id="field-order-invoice-input"
                className="input"
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                aria-label="Field order invoice amount"
                disabled={busy}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setStatus(null);
                }}
              />
            </div>
          ) : money.invoice != null ? (
            <div className="last-min-paint-row">
              <span>Invoice amount</span>
              <strong>{formatMaterialDollars(money.invoice)}</strong>
            </div>
          ) : null}
          {canEdit ? (
            <div className="row-gap wrap">
              <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void onSave()}>
                {busy ? "Saving…" : "Save invoice"}
              </button>
              {status ? <p className="muted small">{status}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
