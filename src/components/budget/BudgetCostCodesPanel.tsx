import { useRef } from "react";
import { importCostCodesFile, importPainterWorkbook } from "../../lib/budgetLibrary";
import {
  CODE_TYPES,
  emptyCostCodeRecord,
  emptyEquipmentCostCodeRecord,
  emptyEquipmentRentCostCodeRecord,
  type CostClassRecord,
  type CostCodeRecord,
} from "../../types/budgetMaker";

type Props = {
  codes: CostCodeRecord[];
  onCodesChange: (codes: CostCodeRecord[]) => void;
  onClassesChange: (classes: CostClassRecord[]) => void;
  onError: (message: string | null) => void;
};

function patchCode(codes: CostCodeRecord[], index: number, patch: Partial<CostCodeRecord>): CostCodeRecord[] {
  return codes.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

export function BudgetCostCodesPanel({ codes, onCodesChange, onClassesChange, onError }: Props) {
  const painterRef = useRef<HTMLInputElement>(null);
  const codesRef = useRef<HTMLInputElement>(null);

  async function onPainterFile(file: File | null) {
    if (!file) return;
    try {
      const { cost_codes, cost_classes } = await importPainterWorkbook(file);
      onCodesChange(cost_codes);
      onClassesChange(cost_classes);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    }
  }

  async function onCodesFile(file: File | null) {
    if (!file) return;
    try {
      onCodesChange(await importCostCodesFile(file));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    }
  }

  return (
    <div className="stack budget-settings-panel">
      <p className="muted small">
        Add or edit cost codes here. The same code number can appear twice with different classes — e.g.{" "}
        <strong>997</strong> class <strong>4</strong> (owned) and <strong>997</strong> class <strong>5</strong>{" "}
        (rent). Use <strong>4 OR 5</strong> in Class when one row should allow either at bucket setup.
      </p>
      <div className="row-gap wrap">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => painterRef.current?.click()}>
          Import Painter workbook…
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => codesRef.current?.click()}>
          Import cost codes CSV…
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onCodesChange([...codes, emptyCostCodeRecord()])}
        >
          Add row
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onCodesChange([...codes, emptyEquipmentCostCodeRecord()])}
        >
          Add 997 owned
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onCodesChange([...codes, emptyEquipmentRentCostCodeRecord()])}
        >
          Add 997 rent
        </button>
        <span className="muted small">{codes.length} code(s)</span>
        <input
          ref={painterRef}
          type="file"
          hidden
          accept=".xlsx,.xls,.xlsm"
          onChange={(e) => void onPainterFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={codesRef}
          type="file"
          hidden
          accept=".csv,.xlsx,.xls"
          onChange={(e) => void onCodesFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="paint-settings-table-wrap settings-scroll-table-wrap">
        <table className="paint-settings-table">
          <thead>
            <tr>
              <th>GL</th>
              <th>Code</th>
              <th>Description</th>
              <th>Type</th>
              <th>Class</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted small">
                  No cost codes yet — import a file or add a row.
                </td>
              </tr>
            ) : (
              codes.map((c, i) => (
                <tr key={`${c.cost_code}-${c.cost_class}-${i}`}>
                  <td>
                    <input
                      value={c.gl_account}
                      onChange={(e) => onCodesChange(patchCode(codes, i, { gl_account: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      value={c.cost_code}
                      onChange={(e) => onCodesChange(patchCode(codes, i, { cost_code: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      value={c.description}
                      onChange={(e) => onCodesChange(patchCode(codes, i, { description: e.target.value }))}
                    />
                  </td>
                  <td>
                    <select
                      value={c.type}
                      onChange={(e) => onCodesChange(patchCode(codes, i, { type: e.target.value }))}
                    >
                      {CODE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={c.cost_class}
                      placeholder="1 or 4 OR 5"
                      onChange={(e) => onCodesChange(patchCode(codes, i, { cost_class: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onCodesChange(codes.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
