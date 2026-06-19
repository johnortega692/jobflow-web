import { useMemo, useState } from "react";
import { searchMaterialVendors } from "../../lib/contactDirectory";
import type { MaterialVendor } from "../../types/contactDirectory";

type Props = {
  title: string;
  vendors: MaterialVendor[];
  onConfirm: (vendor: string, email: string) => void;
  onClose: () => void;
};

export function VendorOrderModal({ title, vendors, onConfirm, onClose }: Props) {
  const [vendor, setVendor] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => searchMaterialVendors(vendors, vendor), [vendor, vendors]);

  const datalistOptions = useMemo(() => {
    const names = new Set<string>();
    for (const v of vendors) {
      if (v.name.trim()) names.add(v.name.trim());
      for (const part of v.products.split(",")) {
        const p = part.trim();
        if (p) names.add(p);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  function lookup() {
    if (!matches.length) {
      setError(
        "No vendor match. Search by contact name or product (e.g. Maharam). Add vendors under Settings.",
      );
      return;
    }
    const hit = matches[0]!;
    setVendor(hit.products.trim() || hit.name);
    setEmail(hit.email);
    setError(null);
  }

  function confirm() {
    const name = vendor.trim();
    if (!name) {
      setError("Enter a vendor or product name.");
      return;
    }
    onConfirm(name, email.trim());
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack"
        role="dialog"
        aria-labelledby="vendor-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="vendor-order-title">{title}</h3>
        <p className="muted small">
          Only items with the <strong>Order</strong> checkbox checked will be included. Look up by
          vendor name or product line.
        </p>
        <label>
          Vendor / product
          <div className="row-gap">
            <input
              className="flex-1"
              value={vendor}
              onChange={(e) => {
                setVendor(e.target.value);
                setError(null);
              }}
              list="vendor-order-list"
            />
            <button type="button" className="btn btn-secondary btn-small" onClick={lookup}>
              Look up
            </button>
          </div>
          <datalist id="vendor-order-list">
            {datalistOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        {matches.length > 1 && (
          <p className="muted small">
            {matches.length} matches — using first: {matches[0]!.name}
            {matches[0]!.products ? ` (${matches[0]!.products})` : ""}
          </p>
        )}
        <label>
          Vendor email (optional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" onClick={confirm}>
            Continue
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
