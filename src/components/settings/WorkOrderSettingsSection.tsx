import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  loadWorkOrderUserSettings,
  resetWorkOrderFonts,
  resetWorkOrderLaborRates,
  resetWorkOrderMaterials,
  saveWorkOrderFonts,
  saveWorkOrderLaborRates,
  saveWorkOrderMaterials,
} from "../../lib/workOrderUserSettings";
import { FONT_SETTING_FIELDS } from "../../lib/workOrderFonts";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import {
  defaultWorkOrderFontSettings,
  type WorkOrderFontSettings,
  type WorkOrderLaborRateItem,
  type WorkOrderMaterialCatalogItem,
} from "../../types/workOrderSettings";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

function emptyMaterial(): WorkOrderMaterialCatalogItem {
  return { name: "", price: 0, markup_percent: 0, tax_percent: 0, category: "General" };
}

function emptyLaborRate(): WorkOrderLaborRateItem {
  return { name: "", billing_rate: 0, raw_cost_per_hour: 0 };
}

type TrackData = {
  materials: WorkOrderMaterialCatalogItem[];
  laborRates: WorkOrderLaborRateItem[];
  fonts: WorkOrderFontSettings;
};

export function WorkOrderSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<WorkOrderMaterialCatalogItem[]>([]);
  const [laborRates, setLaborRates] = useState<WorkOrderLaborRateItem[]>([]);
  const [fonts, setFonts] = useState<WorkOrderFontSettings>(defaultWorkOrderFontSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trackData = useMemo<TrackData>(() => ({ materials, laborRates, fonts }), [materials, laborRates, fonts]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadWorkOrderUserSettings(user.id)
      .then((s) => {
        setMaterials(s.materials);
        setLaborRates(s.laborRates);
        setFonts(s.fonts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load work order settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const nextMaterials = materials.filter((m) => m.name.trim());
    const nextLabor = laborRates.filter((r) => r.name.trim());
    const errMat = await saveWorkOrderMaterials(user.id, nextMaterials);
    if (errMat) {
      setError(errMat);
      setSaving(false);
      return false;
    }
    const errLab = await saveWorkOrderLaborRates(user.id, nextLabor);
    if (errLab) {
      setError(errLab);
      setSaving(false);
      return false;
    }
    const errFont = await saveWorkOrderFonts(user.id, fonts);
    setSaving(false);
    if (errFont) {
      setError(errFont);
      return false;
    }
    setMaterials(nextMaterials);
    setLaborRates(nextLabor);
    markSaved();
    setMessage("Work order settings saved.");
    return true;
  }, [user?.id, materials, laborRates, fonts, markSaved]);

  const discard = useCallback(async () => {
    if (!user?.id) return;
    const s = await loadWorkOrderUserSettings(user.id);
    setMaterials(s.materials);
    setLaborRates(s.laborRates);
    setFonts(s.fonts);
    markSaved();
    setMessage(null);
    setError(null);
  }, [user?.id, markSaved]);

  useEffect(() => {
    if (readOnly) return;
    onBindActions?.({ save: persist, discard, getIsDirty });
  }, [onBindActions, persist, discard, getIsDirty, readOnly]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  if (loading) return <p className="muted">Loading work order settings…</p>;

  return (
    <form className="stack" onSubmit={(e) => void onSubmit(e)}>
      {readOnly && <SharedSettingsNotice />}
      <p className="muted">
        Material library, labor rates, and overlay font sizes — used on the Work Orders editor (same role as desktop{" "}
        <code>materials.txt</code> / <code>labor_rates.txt</code>).
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
      <section className="card stack">
        <div className="row-between wrap">
          <h2>Material library</h2>
          {!readOnly && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMaterials((m) => [...m, emptyMaterial()])}>
            Add material
          </button>
          )}
        </div>
        <div className="table-wrap settings-scroll-table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Markup %</th>
                <th>Tax %</th>
                <th>Category</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={m.name}
                      onChange={(e) =>
                        setMaterials((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.01}
                      value={m.price || ""}
                      onChange={(e) =>
                        setMaterials((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, price: Number(e.target.value) || 0 } : r)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.1}
                      value={m.markup_percent || ""}
                      onChange={(e) =>
                        setMaterials((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, markup_percent: Number(e.target.value) || 0 } : r)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.1}
                      value={m.tax_percent || ""}
                      onChange={(e) =>
                        setMaterials((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, tax_percent: Number(e.target.value) || 0 } : r)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={m.category}
                      onChange={(e) =>
                        setMaterials((rows) => rows.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setMaterials((rows) => rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void resetWorkOrderMaterials(user!.id).then(() => discard())}
        >
          Reset materials to defaults
        </button>
        )}
      </section>

      <section className="card stack">
        <div className="row-between wrap">
          <h2>Labor rates</h2>
          {!readOnly && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLaborRates((r) => [...r, emptyLaborRate()])}>
            Add rate
          </button>
          )}
        </div>
        <div className="table-wrap settings-scroll-table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Billing $/hr</th>
                <th>Raw $/hr</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {laborRates.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={r.name}
                      onChange={(e) =>
                        setLaborRates((rows) => rows.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.01}
                      value={r.billing_rate || ""}
                      onChange={(e) =>
                        setLaborRates((rows) =>
                          rows.map((row, j) => (j === i ? { ...row, billing_rate: Number(e.target.value) || 0 } : row)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.01}
                      value={r.raw_cost_per_hour || ""}
                      onChange={(e) =>
                        setLaborRates((rows) =>
                          rows.map((row, j) =>
                            j === i ? { ...row, raw_cost_per_hour: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setLaborRates((rows) => rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void resetWorkOrderLaborRates(user!.id).then(() => discard())}
        >
          Reset labor rates to defaults
        </button>
        )}
      </section>

      <section className="card stack">
        <h2>Overlay text</h2>
        <div className="grid-3">
          {FONT_SETTING_FIELDS.map(({ key, label }) => (
            <label key={key}>
              {label} (pt)
              <input
                type="number"
                min={8}
                max={36}
                value={fonts[key] as number}
                onChange={(e) =>
                  setFonts((f) => ({ ...f, [key]: Number(e.target.value) || 14 }))
                }
              />
            </label>
          ))}
          <label>
            Text color
            <input
              type="color"
              value={fonts.overlay_color}
              onChange={(e) => setFonts((f) => ({ ...f, overlay_color: e.target.value }))}
            />
          </label>
        </div>
        {!readOnly && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void resetWorkOrderFonts(user!.id).then(() => discard())}
        >
          Reset fonts to defaults
        </button>
        )}
      </section>
      </fieldset>

      {!readOnly && (
      <button type="submit" className="btn btn-primary" disabled={saving || !getIsDirty()}>
        {saving ? "Saving…" : "Save work order settings"}
      </button>
      )}
    </form>
  );
}
