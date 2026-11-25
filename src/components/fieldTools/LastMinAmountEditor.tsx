import { useState } from "react";
import { lastMinAmountText, lastMinPlacedAmountText, parseLastMinAmount, saveLastMinAmount } from "../../lib/fieldToolsPoTracker";

type Props = {
  orderId: string;
  payload: Record<string, unknown>;
  canEdit: boolean;
  onSaved: (amount: string) => void;
};

export function LastMinAmountEditor({ orderId, payload, canEdit, onSaved }: Props) {
  const saved = lastMinAmountText(payload);
  const placed = lastMinPlacedAmountText(payload);
  const [amount, setAmount] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const dirty = amount.trim() !== saved;

  async function onSave() {
    const value = parseLastMinAmount(amount);
    if (value == null) {
      setError("Enter the receipt total, like 119.63.");
      setStatus(null);
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const savedAmount = await saveLastMinAmount(orderId, value);
      setAmount(savedAmount);
      onSaved(savedAmount);
      setStatus("Invoice saved. It counts on the material budget.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the total.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-tools-order-cart" id="last-min-amount">
      <p className="field-tools-order-cart-title">Receipt total</p>
      <p className="muted small">
        Order placed is the total submitted with the order. The invoice amount counts on the material budget. Sales tax is not added again.
      </p>
      {error ? <div className="banner banner-error">{error}</div> : null}
      <div className="last-min-paint-row">
        <span>Order placed</span>
        <strong>{placed ? `$${placed}` : "—"}</strong>
      </div>
      <div className="last-min-paint-row">
        <label htmlFor="last-min-amount-input">Invoice amount</label>
        {canEdit ? (
          <input
            id="last-min-amount-input"
            className="input"
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            aria-label="Last-Min invoice amount"
            disabled={busy}
            onChange={(e) => {
              setAmount(e.target.value);
              setStatus(null);
            }}
          />
        ) : (
          <span>{saved ? `$${saved}` : "—"}</span>
        )}
      </div>
      {canEdit ? (
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void onSave()}>
            {busy ? "Saving…" : "Save invoice"}
          </button>
          {status ? <p className="muted small">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
