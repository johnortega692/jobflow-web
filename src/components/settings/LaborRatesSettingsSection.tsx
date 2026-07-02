import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { loadCompanyLaborRates, saveCompanyLaborRates } from "../../lib/companyLaborRates";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import {
  blendedBillRate,
  blendedCostRate,
  defaultLaborRates,
  formatMoney0,
  newLaborRateId,
  type LaborRate,
} from "../../types/projectBilling";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

export function LaborRatesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [rates, setRates] = useState<LaborRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = !loading && Boolean(user?.id);
  const { markSaved, getIsDirty } = useSettingsDirtyTracker(rates, ready, onDirtyChange);

  useEffect(() => {
    setLoading(true);
    void loadCompanyLaborRates()
      .then(setRates)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load labor rates"))
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const cleaned = rates.filter((r) => r.className.trim());
    const err = await saveCompanyLaborRates(cleaned, user.id);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    setRates(cleaned);
    markSaved();
    setMessage("Company labor rates saved. New projects will copy these.");
    return true;
  }, [user?.id, rates, markSaved]);

  const discard = useCallback(async () => {
    const s = await loadCompanyLaborRates();
    setRates(s);
    markSaved();
    setMessage(null);
    setError(null);
  }, [markSaved]);

  useEffect(() => {
    if (readOnly) return;
    onBindActions?.({ save: persist, discard, getIsDirty });
  }, [onBindActions, persist, discard, getIsDirty, readOnly]);

  const bCost = useMemo(() => blendedCostRate(rates), [rates]);
  const bBill = useMemo(() => blendedBillRate(rates), [rates]);

  function patch(id: string, p: Partial<LaborRate>) {
    setRates((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }
  function num(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  if (loading) return <p className="muted">Loading labor rates…</p>;

  return (
    <form className="stack" onSubmit={(e) => void onSubmit(e)}>
      {readOnly && <SharedSettingsNotice />}
      <p className="muted">
        Default labor classes used to seed the project Billing tab. New projects copy these; per-job
        edits don&apos;t affect these defaults.
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
        <section className="card stack">
          <div className="row-between wrap">
            <h2>Labor rates</h2>
            {!readOnly && (
              <div className="row-gap wrap">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRates(defaultLaborRates())}
                >
                  Reset to seed defaults
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    setRates((rs) => [
                      ...rs,
                      { id: newLaborRateId(), className: "", costRate: 0, billRate: 0, crewMix: 1 },
                    ])
                  }
                >
                  Add class
                </button>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Cost/hr</th>
                  <th>Bill/hr</th>
                  <th>Crew mix</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        value={r.className}
                        placeholder="Class name"
                        onChange={(e) => patch(r.id, { className: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={r.costRate === 0 ? "" : r.costRate}
                        placeholder="0"
                        onChange={(e) => patch(r.id, { costRate: num(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={r.billRate === 0 ? "" : r.billRate}
                        placeholder="0"
                        onChange={(e) => patch(r.id, { billRate: num(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={r.crewMix === 0 ? "" : r.crewMix}
                        placeholder="0"
                        onChange={(e) => patch(r.id, { crewMix: num(e.target.value) })}
                      />
                    </td>
                    <td>
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => setRates((rs) => rs.filter((x) => x.id !== r.id))}
                          aria-label="Remove class"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Blended (crew-mix weighted)</td>
                  <td>{formatMoney0(bCost)}</td>
                  <td>{formatMoney0(bBill)}</td>
                  <td colSpan={2}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </fieldset>

      {!readOnly && (
        <div className="row-gap">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save labor rates"}
          </button>
        </div>
      )}
    </form>
  );
}
