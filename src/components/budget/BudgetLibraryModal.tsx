import { useRef, useState } from "react";
import {
  importCostClassesFile,
  importCostCodesFile,
  importPainterWorkbook,
  saveBudgetLibrary,
} from "../../lib/budgetLibrary";
import type { BudgetLibrary, CostClassRecord, CostCodeRecord } from "../../types/budgetMaker";

type Props = {
  userId: string;
  library: BudgetLibrary;
  onClose: () => void;
  onSaved: (lib: BudgetLibrary) => void;
};

export function BudgetLibraryModal({ userId, library, onClose, onSaved }: Props) {
  const [codes, setCodes] = useState<CostCodeRecord[]>(() => [...library.cost_codes]);
  const [classes, setClasses] = useState<CostClassRecord[]>(() => [...library.cost_classes]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const painterRef = useRef<HTMLInputElement>(null);
  const codesRef = useRef<HTMLInputElement>(null);
  const classesRef = useRef<HTMLInputElement>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const next: BudgetLibrary = { ...library, cost_codes: codes, cost_classes: classes };
    const err = await saveBudgetLibrary(userId, next);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onSaved(next);
    onClose();
  }

  async function onPainterFile(file: File | null) {
    if (!file) return;
    try {
      const { cost_codes, cost_classes } = await importPainterWorkbook(file);
      setCodes(cost_codes);
      setClasses(cost_classes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  async function onCodesFile(file: File | null) {
    if (!file) return;
    try {
      setCodes(await importCostCodesFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  async function onClassesFile(file: File | null) {
    if (!file) return;
    try {
      setClasses(await importCostClassesFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack budget-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Cost codes & classes</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">
          Import from your Painter workbook (Painter Cost Codes + cost classes sheets) or CSV files.
        </p>
        {error && <div className="banner banner-error">{error}</div>}

        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => painterRef.current?.click()}>
            Import Painter workbook…
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => codesRef.current?.click()}>
            Import cost codes CSV…
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => classesRef.current?.click()}>
            Import cost classes CSV…
          </button>
          <input ref={painterRef} type="file" hidden accept=".xlsx,.xls,.xlsm" onChange={(e) => void onPainterFile(e.target.files?.[0] ?? null)} />
          <input ref={codesRef} type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => void onCodesFile(e.target.files?.[0] ?? null)} />
          <input ref={classesRef} type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => void onClassesFile(e.target.files?.[0] ?? null)} />
        </div>

        <div className="grid-2 budget-settings-grid">
          <section className="stack">
            <h3>Cost codes ({codes.length})</h3>
            <div className="table-wrap budget-mini-table">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Class</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.slice(0, 80).map((c, i) => (
                    <tr key={`${c.cost_code}-${i}`}>
                      <td>{c.cost_code}</td>
                      <td>{c.description}</td>
                      <td>{c.type}</td>
                      <td>{c.cost_class}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {codes.length > 80 && <p className="muted small">Showing first 80 of {codes.length} rows.</p>}
          </section>
          <section className="stack">
            <h3>Cost classes ({classes.length})</h3>
            <div className="table-wrap budget-mini-table">
              <table>
                <thead>
                  <tr>
                    <th>GL</th>
                    <th>Class</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.slice(0, 80).map((c, i) => (
                    <tr key={`${c.cost_class}-${i}`}>
                      <td>{c.gl_acct}</td>
                      <td>{c.cost_class}</td>
                      <td>{c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="row-between">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save library"}
          </button>
        </div>
      </div>
    </div>
  );
}
