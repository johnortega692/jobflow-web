import { useEffect, useState } from "react";
import { getFieldToolsOrder } from "../../lib/fieldToolsPoTracker";
import {
  buildOrderDetailGroups,
  buildOrderDetailRows,
  countCartGroups,
  orderTypeLabel,
} from "../../lib/fieldToolsOrderView";
import type { FieldToolsOrder } from "../../types/fieldToolsOrder";

type Props = {
  orderId: string;
  poNumber: string;
  receivedField: boolean;
  completed: boolean;
  trackingBusy?: boolean;
  onToggleReceived: (next: boolean) => void;
  onToggleCompleted: (next: boolean) => void;
  onClose: () => void;
};

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FieldToolsOrderViewModal({
  orderId,
  poNumber,
  receivedField,
  completed,
  trackingBusy,
  onToggleReceived,
  onToggleCompleted,
  onClose,
}: Props) {
  const [order, setOrder] = useState<FieldToolsOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getFieldToolsOrder(orderId)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load order.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const groups = order ? buildOrderDetailGroups(order) : [];
  const detailRows = order ? buildOrderDetailRows(order) : [];
  const totalItems = countCartGroups(groups);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack field-tools-order-modal"
        role="dialog"
        aria-labelledby="field-tools-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap">
          <div>
            <h3 id="field-tools-order-title">PO# {poNumber}</h3>
            {order && (
              <p className="muted small">
                {order.job_number}
                {order.job_name ? ` — ${order.job_name}` : ""} · {orderTypeLabel(order.order_type)}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p className="muted">Loading order…</p>}
        {error && <div className="banner banner-error">{error}</div>}

        <div className="field-tools-order-tracking">
          <label className="field-tools-order-tracking-check">
            <input
              type="checkbox"
              checked={receivedField}
              disabled={trackingBusy}
              onChange={(e) => onToggleReceived(e.target.checked)}
            />
            <span>Received Field</span>
          </label>
          <label className="field-tools-order-tracking-check">
            <input
              type="checkbox"
              checked={completed}
              disabled={trackingBusy}
              onChange={(e) => onToggleCompleted(e.target.checked)}
            />
            <span>Completed</span>
          </label>
        </div>

        {order && !loading && (
          <>
            <div className="field-tools-order-meta">
              <p className="muted small">
                Submitted {formatSubmittedAt(order.created_at)} by {order.submitted_by_name || "—"}
                {order.email_status ? ` · Email ${order.email_status}` : ""}
              </p>
            </div>

            {detailRows.length > 0 && (
              <div className="field-tools-order-details">
                {detailRows.map((row) => (
                  <div key={row.label} className="field-tools-order-detail-row">
                    <div className="field-tools-order-detail-label">{row.label}</div>
                    <div className="field-tools-order-detail-value">{row.value}</div>
                  </div>
                ))}
              </div>
            )}

            {groups.length > 0 ? (
              <div className="field-tools-order-cart">
                <p className="field-tools-order-cart-title">
                  Line items · {totalItems} item{totalItems !== 1 ? "s" : ""}
                </p>
                {groups.map((group) => (
                  <div key={group.section} className="field-tools-order-group">
                    <div className="field-tools-order-group-title">{group.section}</div>
                    {group.items.map((item) => (
                      <div key={item.id} className="field-tools-order-line">
                        <div className="field-tools-order-line-main">
                          <div className="field-tools-order-line-name">{item.name}</div>
                          {item.detail && <div className="muted small">{item.detail}</div>}
                        </div>
                        {item.quantity && <div className="field-tools-order-line-qty">{item.quantity}</div>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No line items recorded for this order.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
