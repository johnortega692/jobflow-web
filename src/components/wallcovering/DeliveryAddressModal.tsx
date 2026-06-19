import { useState } from "react";

type Props = {
  defaultAddress: string;
  warehouseAddress: string;
  onConfirm: (address: string) => void;
  onClose: () => void;
};

export function DeliveryAddressModal({
  defaultAddress,
  warehouseAddress,
  onConfirm,
  onClose,
}: Props) {
  const options = [
    ...(defaultAddress && defaultAddress !== warehouseAddress ? [defaultAddress] : []),
    warehouseAddress,
  ];
  const [address, setAddress] = useState(defaultAddress || warehouseAddress);

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
        <label>
          Address
          <input
            list="delivery-address-options"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <datalist id="delivery-address-options">
            {options.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </label>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const trimmed = address.trim();
              if (!trimmed) return;
              onConfirm(trimmed);
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
