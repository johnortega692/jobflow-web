import { useEffect, useMemo, useState } from "react";
import {
  listMaterialOrderPoHistoryForProject,
  materialOrderScopeLabel,
  type MaterialOrderPoHistoryEntry,
} from "../../lib/materialOrderPo";

type AddressOption = {
  id: string;
  label: string;
  value: string;
};

type Props = {
  defaultAddress: string;
  warehouseAddress: string;
  /** Company / letterhead address from Settings → Profile & letterhead. */
  companyAddress?: string;
  /** Project job number shown as the PO prefix hint. */
  jobNumber?: string;
  /** Load PO history for this project (used POs for regenerating PDFs). */
  projectId?: string;
  /** Preview the next available PO (does not assign until confirm). */
  onRequestNextPo: () => Promise<string>;
  onConfirm: (address: string, poNumber: string) => void;
  onClose: () => void;
};

function buildAddressOptions(input: {
  jobSite: string;
  company: string;
  warehouse: string;
}): AddressOption[] {
  const candidates: AddressOption[] = [
    { id: "job", label: "Job site", value: input.jobSite.trim() },
    { id: "company", label: "Company", value: input.company.trim() },
    { id: "warehouse", label: "Warehouse", value: input.warehouse.trim() },
  ];
  const seen = new Set<string>();
  const out: AddressOption[] = [];
  for (const opt of candidates) {
    if (!opt.value) continue;
    const key = opt.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(opt);
  }
  return out;
}

function formatHistoryLabel(entry: MaterialOrderPoHistoryEntry): string {
  const parts = [entry.poNumber, materialOrderScopeLabel(entry.scope)];
  if (entry.vendorLabel) parts.push(entry.vendorLabel);
  return parts.join(" · ");
}

export function DeliveryAddressModal({
  defaultAddress,
  warehouseAddress,
  companyAddress = "",
  jobNumber = "",
  projectId = "",
  onRequestNextPo,
  onConfirm,
  onClose,
}: Props) {
  const options = useMemo(
    () =>
      buildAddressOptions({
        jobSite: defaultAddress,
        company: companyAddress,
        warehouse: warehouseAddress,
      }),
    [defaultAddress, companyAddress, warehouseAddress],
  );
  const [address, setAddress] = useState(defaultAddress.trim() || options[0]?.value || "");
  const [poNumber, setPoNumber] = useState("");
  const [history, setHistory] = useState<MaterialOrderPoHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nextPoBusy, setNextPoBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId.trim()) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void listMaterialOrderPoHistoryForProject(projectId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selectedId =
    options.find((opt) => opt.value.toLowerCase() === address.trim().toLowerCase())?.id ?? null;
  const poPlaceholder = jobNumber.trim()
    ? `e.g. ${jobNumber.trim().split(/\s+/)[0]}-001`
    : "e.g. 1058-001";
  const historySelectValue = history.some((h) => h.poNumber === poNumber.trim())
    ? poNumber.trim()
    : "";

  function applyHistoryEntry(po: string) {
    const entry = history.find((h) => h.poNumber === po);
    if (!entry) return;
    setPoNumber(entry.poNumber);
    if (entry.deliveryAddress) setAddress(entry.deliveryAddress);
    setLocalError(null);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack"
        role="dialog"
        aria-labelledby="delivery-address-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delivery-address-title">Delivery address</h3>
        <p className="muted small">Select or enter the delivery address for this order.</p>

        {options.length > 0 && (
          <div className="delivery-address-presets" role="group" aria-label="Saved addresses">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`delivery-address-preset${selectedId === opt.id ? " delivery-address-preset--active" : ""}`}
                onClick={() => setAddress(opt.value)}
              >
                <span className="delivery-address-preset-label">{opt.label}</span>
                <span className="delivery-address-preset-value">{opt.value}</span>
              </button>
            ))}
          </div>
        )}

        <label>
          Address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Select above or type a custom address"
          />
        </label>

        <label>
          PO history
          <select
            value={historySelectValue}
            disabled={historyLoading || history.length === 0}
            onChange={(e) => {
              const value = e.target.value;
              if (value) applyHistoryEntry(value);
            }}
            aria-label="Previously used purchase order numbers"
          >
            <option value="">
              {historyLoading
                ? "Loading history…"
                : history.length
                  ? "Select a previous PO…"
                  : "No previous POs for this project"}
            </option>
            {history.map((entry) => (
              <option key={entry.poNumber} value={entry.poNumber}>
                {formatHistoryLabel(entry)}
              </option>
            ))}
          </select>
        </label>

        <label>
          PO#
          <input
            value={poNumber}
            onChange={(e) => {
              setPoNumber(e.target.value);
              setLocalError(null);
            }}
            placeholder={poPlaceholder}
            aria-label="Purchase order number"
          />
        </label>
        <p className="muted small">
          PO numbers are not assigned automatically. Use Get next PO for a new number, or pick one
          from history to regenerate a corrected PDF.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={nextPoBusy}
          onClick={() => {
            setNextPoBusy(true);
            setLocalError(null);
            void onRequestNextPo()
              .then((next) => {
                if (next.trim()) setPoNumber(next.trim());
                else setLocalError("Could not load the next PO number.");
              })
              .catch((e) => {
                setLocalError(e instanceof Error ? e.message : "Could not load the next PO number.");
              })
              .finally(() => setNextPoBusy(false));
          }}
        >
          {nextPoBusy ? "Loading…" : "Get next PO"}
        </button>
        {localError && <div className="banner banner-error">{localError}</div>}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const trimmed = address.trim();
              const po = poNumber.trim();
              if (!trimmed) {
                setLocalError("Enter a delivery address.");
                return;
              }
              if (!po) {
                setLocalError("Get next PO, pick from history, or enter a PO number before continuing.");
                return;
              }
              onConfirm(trimmed, po);
            }}
          >
            Use this address
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
