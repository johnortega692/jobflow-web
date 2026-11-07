import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteOrderReceiptImage,
  listOrderReceiptImages,
  type OrderReceiptImage,
} from "../../lib/fieldToolsPoTracker";
import { ReceiptImageViewer } from "./ReceiptImageViewer";

type Props = {
  orderId: string;
  poNumber: string;
  onClose: () => void;
  onReceiptCount?: (count: number) => void;
};

export function LastMinReceiptsModal({ orderId, poNumber, onClose, onReceiptCount }: Props) {
  const { isAdmin } = useAuth();
  const [receipts, setReceipts] = useState<OrderReceiptImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printSlot, setPrintSlot] = useState<HTMLSpanElement | null>(null);

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

  async function deleteReceipt(receiptId: string) {
    await deleteOrderReceiptImage(receiptId);
    const next = receipts.filter((row) => row.id !== receiptId);
    setReceipts(next);
    onReceiptCount?.(next.length);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack field-tools-order-modal field-tools-order-modal-wide"
        role="dialog"
        aria-labelledby="last-min-receipts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap">
          <div>
            <h3 id="last-min-receipts-title">Receipt · PO# {poNumber}</h3>
          </div>
          <div className="receipt-modal-actions">
            <span ref={setPrintSlot} className="receipt-modal-print-slot" />
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" title="Close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {loading && <p className="muted">Loading receipt…</p>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && receipts.length === 0 && (
          <p className="muted">No receipt was saved with this order.</p>
        )}

        <ReceiptImageViewer
          receipts={receipts}
          poNumber={poNumber}
          onDelete={isAdmin ? deleteReceipt : undefined}
          printTarget={printSlot}
        />
      </div>
    </div>
  );
}
