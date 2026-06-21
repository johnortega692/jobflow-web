import { useMemo, useState } from "react";
import type { FrpCatalog } from "../../lib/frpCatalog";
import { frpManufacturersWithTrims, frpTrimProducts } from "../../lib/frpCatalog";
import type { FrpItem } from "../../types/tradeDocuments";
import { emptyFrpItem } from "../../types/tradeDocuments";

type Props = {
  catalog: FrpCatalog;
  onAdd: (items: FrpItem[]) => void;
  onClose: () => void;
};

export function FrpAddTrimModal({ catalog, onAdd, onClose }: Props) {
  const manufacturers = useMemo(() => frpManufacturersWithTrims(catalog), [catalog]);
  const [manufacturer, setManufacturer] = useState(manufacturers[0] ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const trimProducts = manufacturer ? frpTrimProducts(catalog, manufacturer) : [];

  function toggleProduct(product: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [product]: checked }));
  }

  function onManufacturerChange(next: string) {
    setManufacturer(next);
    setSelected({});
  }

  function onConfirm() {
    const picks = trimProducts.filter((p) => selected[p]);
    if (!picks.length) return;
    onAdd(
      picks.map((product) => ({
        ...emptyFrpItem(),
        manufacturer,
        product,
      })),
    );
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack"
        role="dialog"
        aria-labelledby="frp-add-trim-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="frp-add-trim-title">Add trim items</h3>
        <p className="muted small">
          Select a manufacturer, then check the trim products to add.
        </p>
        {!manufacturers.length ? (
          <p className="muted">No manufacturers have trim products configured.</p>
        ) : (
          <>
            <label>
              Manufacturer
              <select value={manufacturer} onChange={(e) => onManufacturerChange(e.target.value)}>
                {manufacturers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <div className="stack frp-trim-list">
              {trimProducts.map((product) => (
                <label key={product} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[product])}
                    onChange={(e) => toggleProduct(product, e.target.checked)}
                  />
                  {product}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!manufacturers.length}
            onClick={onConfirm}
          >
            Add selected
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
