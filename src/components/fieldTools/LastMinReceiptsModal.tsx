import { useEffect, useState } from "react";
import { listOrderReceiptImages, type OrderReceiptImage } from "../../lib/fieldToolsPoTracker";

type Props = {
  orderId: string;
  poNumber: string;
  onClose: () => void;
};

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function LastMinReceiptsModal({ orderId, poNumber, onClose }: Props) {
  const [receipts, setReceipts] = useState<OrderReceiptImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listOrderReceiptImages(orderId)
      .then((rows) => {
        if (!cancelled) setReceipts(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load receipts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack field-tools-order-modal"
        role="dialog"
        aria-labelledby="last-min-receipts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap">
          <div>
            <h3 id="last-min-receipts-title">Receipt · PO# {poNumber}</h3>
            <p className="muted small">Last-Min store receipt uploaded with this order.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p className="muted">Loading receipt…</p>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && receipts.length === 0 && (
          <p className="muted">No receipt was saved with this order.</p>
        )}

        {receipts.map((receipt) => (
          <figure key={receipt.id} className="stack" style={{ margin: 0 }}>
            <a href={receipt.url} target="_blank" rel="noreferrer">
              <img
                src={receipt.url}
                alt={`Receipt for PO ${poNumber}`}
                style={{ width: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 8 }}
              />
            </a>
            <figcaption className="muted small">
              {formatUploadedAt(receipt.createdAt)}
              {receipt.uploadedBy ? ` · ${receipt.uploadedBy}` : ""}
              {" · "}
              <a href={receipt.url} target="_blank" rel="noreferrer">
                Open full size
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
