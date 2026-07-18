import { useEffect, useMemo, useState } from "react";

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
  /** Suggested next PO from shared sequence (editable). */
  suggestedPo?: string;
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

export function DeliveryAddressModal({
  defaultAddress,
  warehouseAddress,
  companyAddress = "",
  suggestedPo = "",
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
  const [poNumber, setPoNumber] = useState(suggestedPo);

  useEffect(() => {
    setPoNumber(suggestedPo);
  }, [suggestedPo]);

  const selectedId =
    options.find((opt) => opt.value.toLowerCase() === address.trim().toLowerCase())?.id ?? null;

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
          PO#
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="e.g. 1058-002"
            aria-label="Purchase order number"
          />
        </label>
        <p className="muted small">
          Uses the same job sequence as Field Tools. Leave as suggested to take the next number, or
          edit to reuse/override.
        </p>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const trimmed = address.trim();
              if (!trimmed) return;
              onConfirm(trimmed, poNumber.trim());
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
