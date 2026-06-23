import { useRef } from "react";
import { importCostClassesFile } from "../../lib/budgetLibrary";
import { emptyCostClassRecord, type CostClassRecord } from "../../types/budgetMaker";

type Props = {
  classes: CostClassRecord[];
  onClassesChange: (classes: CostClassRecord[]) => void;
  onError: (message: string | null) => void;
};

function patchClass(
  classes: CostClassRecord[],
  index: number,
  patch: Partial<CostClassRecord>,
): CostClassRecord[] {
  return classes.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

export function BudgetCostClassesPanel({ classes, onClassesChange, onError }: Props) {
  const classesRef = useRef<HTMLInputElement>(null);

  async function onClassesFile(file: File | null) {
    if (!file) return;
    try {
      onClassesChange(await importCostClassesFile(file));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    }
  }

  return (
    <div className="stack budget-settings-panel">
      <p className="muted small">
        Add or edit cost classes (GL account, class number, description). Class <strong>4</strong> is
        owned equipment; <strong>5</strong> is rented equipment.
      </p>
      <div className="row-gap wrap">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => classesRef.current?.click()}>
          Import cost classes CSV…
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onClassesChange([...classes, emptyCostClassRecord()])}
        >
          Add row
        </button>
        <span className="muted small">{classes.length} class(es)</span>
        <input
          ref={classesRef}
          type="file"
          hidden
          accept=".csv,.xlsx,.xls"
          onChange={(e) => void onClassesFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="paint-settings-table-wrap settings-scroll-table-wrap">
        <table className="paint-settings-table">
          <thead>
            <tr>
              <th>GL</th>
              <th>Class</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {classes.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted small">
                  No cost classes yet — import a file or add a row.
                </td>
              </tr>
            ) : (
              classes.map((c, i) => (
                <tr key={`${c.cost_class}-${i}`}>
                  <td>
                    <input
                      value={c.gl_acct}
                      onChange={(e) => onClassesChange(patchClass(classes, i, { gl_acct: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      value={c.cost_class}
                      onChange={(e) => onClassesChange(patchClass(classes, i, { cost_class: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      value={c.description}
                      onChange={(e) => onClassesChange(patchClass(classes, i, { description: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onClassesChange(classes.filter((_, j) => j !== i))}
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
