import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { patchOrgSettings, removeUserSettingsKeys } from "../../lib/budgetLibrary";
import {
  clearPaintCatalogCache,
  loadDefaultPaintProducts,
  loadDefaultPaintSheens,
  loadPaintCatalogSettingsDraft,
  PAINT_MANUFACTURER_OPTIONS,
  PAINT_PRODUCTS_KEY,
  PAINT_SHEENS_KEY,
  type PaintProduct,
} from "../../lib/paintCatalog";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

function emptyProduct(): PaintProduct {
  return { product: "", manufacturer: "PPG" };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

type CatalogTrackData = {
  products: PaintProduct[];
  sheens: string[];
  usingCustomProducts: boolean;
  usingCustomSheens: boolean;
};

export function PaintCatalogSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const [usingCustomProducts, setUsingCustomProducts] = useState(false);
  const [usingCustomSheens, setUsingCustomSheens] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo<CatalogTrackData>(
    () => ({ products, sheens, usingCustomProducts, usingCustomSheens }),
    [products, sheens, usingCustomProducts, usingCustomSheens],
  );
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadPaintCatalogSettingsDraft(user.id)
      .then((draft) => {
        setProducts(draft.products);
        setSheens(draft.sheens);
        setUsingCustomProducts(draft.usingCustomProducts);
        setUsingCustomSheens(draft.usingCustomSheens);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load paint catalog"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const nextProducts = products
      .map((p) => ({ product: p.product.trim(), manufacturer: p.manufacturer.trim() }))
      .filter((p) => p.product);
    const nextSheens = sheens.map((s) => s.trim()).filter(Boolean);
    const err = await patchOrgSettings(user.id, {
      [PAINT_PRODUCTS_KEY]: nextProducts,
      [PAINT_SHEENS_KEY]: nextSheens,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    clearPaintCatalogCache();
    setProducts(nextProducts);
    setSheens(nextSheens);
    setUsingCustomProducts(true);
    setUsingCustomSheens(true);
    markSaved();
    setMessage("Paint product and sheen lists saved.");
    return true;
  }, [markSaved, products, sheens, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) {
          setProducts(snapshot.products);
          setSheens(snapshot.sheens);
          setUsingCustomProducts(snapshot.usingCustomProducts);
          setUsingCustomSheens(snapshot.usingCustomSheens);
        }
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onResetDefaults() {
    if (
      !window.confirm(
        "Reset to the built-in product and sheen lists? Your saved custom lists will be removed.",
      )
    ) {
      return;
    }
    setResetting(true);
    setMessage(null);
    setError(null);
    const err = await removeUserSettingsKeys(user.id, [PAINT_PRODUCTS_KEY, PAINT_SHEENS_KEY]);
    if (err) {
      setResetting(false);
      setError(err);
      return;
    }
    clearPaintCatalogCache();
    const [defaultProducts, defaultSheens] = await Promise.all([
      loadDefaultPaintProducts(),
      loadDefaultPaintSheens(),
    ]);
    setProducts(defaultProducts.map((p) => ({ ...p })));
    setSheens([...defaultSheens]);
    setUsingCustomProducts(false);
    setUsingCustomSheens(false);
    setResetting(false);
    setMessage("Restored built-in product and sheen lists.");
    markSaved();
  }

  function setProduct(i: number, patch: Partial<PaintProduct>) {
    setProducts((list) => {
      const next = [...list];
      next[i] = { ...next[i]!, ...patch };
      return next;
    });
  }

  function setSheen(i: number, value: string) {
    setSheens((list) => {
      const next = [...list];
      next[i] = value;
      return next;
    });
  }

  if (loading) return <p className="muted">Loading paint product &amp; sheen lists…</p>;
  if (!user?.id) return null;

  const usingCustom = usingCustomProducts || usingCustomSheens;

  return (
    <form className="stack paint-catalog-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
      <section className="stack">
        <h2>Paint products &amp; sheens</h2>
        <p className="muted small">
          Product and sheen dropdowns on paint submittals use these lists. Saved to your account
          {usingCustom ? " (custom lists active)" : " (using built-in defaults until you save)"}.
        </p>
      </section>

      <section className="stack">
        <h3>Products</h3>
        <p className="muted small">
          {products.length} product{products.length === 1 ? "" : "s"}. Manufacturer codes match color
          lookup (PPG, SW, BM, etc.).
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Product name</th>
                <th>Manufacturer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={`product-${i}`}>
                  <td>
                    <input
                      value={p.product}
                      onChange={(e) => setProduct(i, { product: e.target.value })}
                      placeholder="ProMar 200"
                    />
                  </td>
                  <td>
                    <select
                      value={p.manufacturer}
                      onChange={(e) => setProduct(i, { manufacturer: e.target.value })}
                    >
                      {PAINT_MANUFACTURER_OPTIONS.map((mfr) => (
                        <option key={mfr} value={mfr}>
                          {mfr}
                        </option>
                      ))}
                      {!PAINT_MANUFACTURER_OPTIONS.includes(
                        p.manufacturer as (typeof PAINT_MANUFACTURER_OPTIONS)[number],
                      ) &&
                        p.manufacturer && (
                          <option value={p.manufacturer}>{p.manufacturer}</option>
                        )}
                    </select>
                  </td>
                  <td className="paint-catalog-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={i === 0}
                      onClick={() => setProducts((list) => moveItem(list, i, i - 1))}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={i === products.length - 1}
                      onClick={() => setProducts((list) => moveItem(list, i, i + 1))}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setProducts((list) => list.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setProducts((list) => [...list, emptyProduct()])}
        >
          Add product
        </button>
      </section>

      <section className="stack">
        <h3>Sheens</h3>
        <p className="muted small">
          {sheens.length} sheen option{sheens.length === 1 ? "" : "s"}. Combined values like
          &quot;Flat and Eggshell&quot; are allowed.
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Sheen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sheens.map((sheen, i) => (
                <tr key={`sheen-${i}`}>
                  <td>
                    <input
                      value={sheen}
                      onChange={(e) => setSheen(i, e.target.value)}
                      placeholder="Eggshell"
                    />
                  </td>
                  <td className="paint-catalog-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={i === 0}
                      onClick={() => setSheens((list) => moveItem(list, i, i - 1))}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={i === sheens.length - 1}
                      onClick={() => setSheens((list) => moveItem(list, i, i + 1))}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSheens((list) => list.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setSheens((list) => [...list, ""])}>
          Add sheen
        </button>
      </section>
      </fieldset>

      {!readOnly && (
      <div className="row-gap">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save product & sheen lists"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={resetting || !usingCustom}
          onClick={() => void onResetDefaults()}
        >
          {resetting ? "Resetting…" : "Reset to built-in defaults"}
        </button>
      </div>
      )}
    </form>
  );
}
