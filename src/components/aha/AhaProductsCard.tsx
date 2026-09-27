import type { AhaProduct } from "../../lib/aha/types";

type Props = {
  rows: AhaProduct[];
  disabled: boolean;
  pulling: boolean;
  onChange: (rows: AhaProduct[]) => void;
  onPull: () => void;
};

export function AhaProductsCard({ rows, disabled, pulling, onChange, onPull }: Props) {
  function patch(id: string, next: Partial<AhaProduct>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  return (
    <section className="card stack aha-table-card">
      <div className="row-between">
        <h3>Products / SDS</h3>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || pulling} onClick={onPull}>
          {pulling ? "Pulling…" : "Pull from job"}
        </button>
      </div>
      <div className="aha-table-scroll">
        <table className="aha-grid-table aha-products-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Manufacturer</th>
              <th>SDS on file</th>
              <th className="aha-col-action" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    className="aha-cell-input"
                    value={row.product}
                    aria-label="Product"
                    disabled={disabled}
                    onChange={(event) => patch(row.id, { product: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="aha-cell-input"
                    value={row.manufacturer}
                    aria-label="Manufacturer"
                    disabled={disabled}
                    onChange={(event) => patch(row.id, { manufacturer: event.target.value })}
                  />
                </td>
                <td>
                  <label className="aha-sds-check">
                    <input
                      type="checkbox"
                      checked={row.sds_on_file}
                      disabled={disabled}
                      aria-label={`SDS on file for ${row.product || "product"}`}
                      onChange={(event) => patch(row.id, { sds_on_file: event.target.checked })}
                    />
                  </label>
                </td>
                <td>
                  <button
                    type="button"
                    className="aha-row-delete"
                    aria-label="Remove product"
                    disabled={disabled}
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={() =>
          onChange([...rows, { id: crypto.randomUUID(), product: "", manufacturer: "", sds_on_file: false }])
        }
      >
        + Add product
      </button>
    </section>
  );
}
