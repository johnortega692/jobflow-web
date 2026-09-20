import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  loadPaintCatalogSettingsDraft,
  paintProductIsHidden,
  paintProductSelectLabel,
  saveHiddenPaintProductNames,
  type PaintProduct,
} from "../../lib/paintCatalog";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

function productSheensLabel(product: PaintProduct): string {
  const sheens = (product.sheens ?? []).map((s) => s.trim()).filter(Boolean);
  return sheens.length ? sheens.join(", ") : "All sheens";
}

function toggleHiddenName(list: string[], productName: string, hidden: boolean): string[] {
  const name = productName.trim();
  const key = name.toLowerCase();
  const without = list.filter((item) => item.trim().toLowerCase() !== key);
  return hidden && name ? [...without, name] : without;
}

type CatalogTab = "products" | "sheens";

const CATALOG_TABS: { id: CatalogTab; label: string }[] = [
  { id: "products", label: "Products" },
  { id: "sheens", label: "Sheens" },
];

type TrackData = {
  hiddenProducts: string[];
};

export function PaintCatalogSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [tab, setTab] = useState<CatalogTab>("products");
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const [hiddenProducts, setHiddenProducts] = useState<string[]>([]);
  const [source, setSource] = useState<"field-tools" | "defaults">("field-tools");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo<TrackData>(() => ({ hiddenProducts }), [hiddenProducts]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(
    trackData,
    ready,
    readOnly ? undefined : onDirtyChange,
  );

  const loadCatalog = useCallback(async (userId: string) => {
    const draft = await loadPaintCatalogSettingsDraft(userId);
    setProducts(draft.products);
    setSheens(draft.sheens);
    setHiddenProducts(draft.hiddenProducts);
    setSource(draft.source);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadCatalog(user.id)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load paint catalog"))
      .finally(() => setLoading(false));
  }, [loadCatalog, user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || readOnly) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveHiddenPaintProductNames(user.id, hiddenProducts);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    markSaved();
    setMessage("Hidden products saved. They stay in Field Tools orders but not paint submittals.");
    return true;
  }, [hiddenProducts, markSaved, readOnly, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) setHiddenProducts(snapshot.hiddenProducts);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onRefresh() {
    if (!user?.id) return;
    setRefreshing(true);
    setMessage(null);
    setError(null);
    try {
      await loadCatalog(user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh paint catalog");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <p className="muted">Loading paint product &amp; sheen lists…</p>;
  if (!user?.id) return null;

  const fromFieldTools = source === "field-tools";
  const hiddenCount = hiddenProducts.length;

  return (
    <form className="stack paint-catalog-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <p className="muted small">
          <strong>Managed in Field Tools.</strong> Paint submittals and brush-out requests use this
          catalog. Add or edit products and sheens in Field Tools admin → Catalog (Paint products and
          Sheens), then refresh here.
        </p>
        {!fromFieldTools && (
          <div className="banner banner-info">
            Could not load the Field Tools catalog, so built-in defaults are shown until it is
            available.
          </div>
        )}
      </section>

      <div className="contact-directory-folders-wrap">
        <div className="contact-directory-folders" role="tablist" aria-label="Paint catalog">
          {CATALOG_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`paint-catalog-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`paint-catalog-panel-${item.id}`}
              className={`contact-directory-folder${tab === item.id ? " contact-directory-folder--active" : ""}`}
              onClick={() => {
                setTab(item.id);
                setError(null);
                setMessage(null);
              }}
            >
              {item.label}
              <span className="contact-directory-folder-count">
                {item.id === "products" ? products.length : sheens.length}
              </span>
            </button>
          ))}
        </div>

        <fieldset
          disabled={readOnly}
          className="contact-directory-folder-panel stack settings-shared-fieldset"
          role="tabpanel"
          id={`paint-catalog-panel-${tab}`}
          aria-labelledby={`paint-catalog-tab-${tab}`}
        >
          {tab === "products" && (
            <section className="stack">
              <p className="muted small">
                Hide primers and other materials you do not want in paint submittal dropdowns. Hidden
                items still appear in Field Tools orders.
                {fromFieldTools ? " Manufacturer codes match color lookup (PPG, SW, BM, etc.)." : ""}
                {hiddenCount ? ` ${hiddenCount} hidden from submittals.` : ""}
              </p>
              <div className="paint-settings-table-wrap settings-scroll-table-wrap">
                <table className="paint-settings-table">
                  <thead>
                    <tr>
                      <th>Product name</th>
                      <th>Manufacturer</th>
                      <th>Sheens</th>
                      <th className="paint-catalog-hide-col">Hide</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!products.length ? (
                      <tr>
                        <td colSpan={4} className="muted small">
                          No Field Tools paint products yet.
                        </td>
                      </tr>
                    ) : (
                      products.map((p, i) => {
                        const hidden = paintProductIsHidden(p.product, hiddenProducts);
                        return (
                          <tr
                            key={`${p.manufacturer}-${p.product}-${i}`}
                            className={hidden ? "paint-catalog-row--hidden" : undefined}
                          >
                            <td>{paintProductSelectLabel(p)}</td>
                            <td>{p.manufacturer || "—"}</td>
                            <td className="muted small">{productSheensLabel(p)}</td>
                            <td className="paint-catalog-hide-col">
                              <label className="paint-catalog-hide-toggle">
                                <input
                                  type="checkbox"
                                  checked={hidden}
                                  onChange={(e) =>
                                    setHiddenProducts((list) =>
                                      toggleHiddenName(list, p.product, e.target.checked),
                                    )
                                  }
                                  aria-label={`Hide ${p.product} from paint submittals`}
                                />
                                <span className="muted small">{hidden ? "Hidden" : "Show"}</span>
                              </label>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "sheens" && (
            <section className="stack">
              <p className="muted small">
                Sheen options from Field Tools. Combined values like &quot;Flat and Eggshell&quot; are
                allowed on submittals.
              </p>
              <div className="paint-settings-table-wrap">
                <table className="paint-settings-table">
                  <thead>
                    <tr>
                      <th>Sheen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!sheens.length ? (
                      <tr>
                        <td className="muted small">No Field Tools sheens yet.</td>
                      </tr>
                    ) : (
                      sheens.map((sheen, i) => (
                        <tr key={`sheen-${i}`}>
                          <td>{sheen}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </fieldset>
      </div>

      <div className="row-gap">
        {!readOnly && (
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save hidden products"}
          </button>
        )}
        <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? "Refreshing…" : "Refresh from Field Tools"}
        </button>
      </div>
    </form>
  );
}
