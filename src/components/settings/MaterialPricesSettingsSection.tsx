import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  draftFromItem,
  getMaterialTax,
  listMaterialPrices,
  moneyInput,
  parsePriceInput,
  parsePricePaste,
  parseTaxPercent,
  saveMaterialPrices,
  saveMaterialTax,
  type MaterialPriceDraft,
  type MaterialPriceItem,
  type MaterialPriceSection,
} from "../../lib/materialPrices";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";

const OPEN_VENDOR = "__open__";

function vendorLabel(id: string): string {
  if (!id) return "All";
  if (id === OPEN_VENDOR) return "All vendors";
  return id;
}

function itemMatchesVendor(item: MaterialPriceItem, vendor: string): boolean {
  if (!vendor) return true;
  if (vendor === OPEN_VENDOR) return item.vendorNames.length === 0;
  return item.vendorNames.includes(vendor);
}

function draftChanged(item: MaterialPriceItem, draft: MaterialPriceDraft | undefined): boolean {
  if (!draft) return false;
  if (item.section === "sundry") return draft.unitCost.trim() !== moneyInput(item.unitCost);
  const saved = draftFromItem(item).sheenCosts;
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft.sheenCosts)]);
  for (const key of keys) {
    if ((draft.sheenCosts[key] ?? "").trim() !== (saved[key] ?? "").trim()) return true;
  }
  return false;
}

export function MaterialPricesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const [items, setItems] = useState<MaterialPriceItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MaterialPriceDraft>>({});
  const [section, setSection] = useState<MaterialPriceSection>("sundry");
  const [vendor, setVendor] = useState("Dunn Edwards");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState("");
  const [taxPercent, setTaxPercent] = useState("10.25");
  const [savedTax, setSavedTax] = useState("10.25");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveGeneration, setSaveGeneration] = useState(0);
  const ready = !loading && !readOnly;
  const tracked = useMemo(() => ({ drafts, taxPercent }), [drafts, taxPercent]);
  const { markSaved, getIsDirty } = useSettingsDirtyTracker(tracked, ready, readOnly ? undefined : onDirtyChange);
  const acceptDrafts = useRef(false);
  const parsedTax = parseTaxPercent(taxPercent);
  const taxDirty = parsedTax == null || parsedTax !== Number(savedTax);

  useEffect(() => {
    if (!acceptDrafts.current || !ready) return;
    acceptDrafts.current = false;
    markSaved();
  }, [drafts, markSaved, ready, saveGeneration, taxPercent]);

  useEffect(() => {
    if (readOnly) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void Promise.all([listMaterialPrices(), getMaterialTax()])
      .then(([next, tax]) => {
        if (cancelled) return;
        const nextDrafts: Record<string, MaterialPriceDraft> = {};
        for (const item of next) nextDrafts[item.id] = draftFromItem(item);
        const taxText = String(tax);
        setItems(next);
        setDrafts(nextDrafts);
        setTaxPercent(taxText);
        setSavedTax(taxText);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load material prices.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly]);

  const vendors = useMemo(() => {
    const names = new Set<string>();
    let open = false;
    for (const item of items) {
      if (item.section !== section) continue;
      if (item.vendorNames.length === 0) open = true;
      for (const name of item.vendorNames) names.add(name);
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), open };
  }, [items, section]);

  useEffect(() => {
    if (!items.length || vendor === "" || vendor === OPEN_VENDOR) return;
    if (vendors.names.includes(vendor)) return;
    setVendor(vendors.names.includes("Dunn Edwards") ? "Dunn Edwards" : "");
  }, [items.length, vendor, vendors.names]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      if (item.section !== section || !itemMatchesVendor(item, vendor)) continue;
      if (item.category.trim()) names.add(item.category.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [items, section, vendor]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => item.section === section && itemMatchesVendor(item, vendor))
      .filter((item) => !category || item.category === category)
      .filter((item) => {
        if (!query) return true;
        return `${item.name} ${item.productId} ${item.category}`.toLowerCase().includes(query);
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [category, items, search, section, vendor]);

  const dirtyItems = useMemo(
    () => items.filter((item) => draftChanged(item, drafts[item.id])),
    [drafts, items],
  );
  const visible = useMemo(() => {
    let cleanCount = 0;
    return filtered.filter((item) => {
      if (draftChanged(item, drafts[item.id])) return true;
      if (cleanCount >= 250) return false;
      cleanCount += 1;
      return true;
    });
  }, [drafts, filtered]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    const nextTax = parseTaxPercent(taxPercent);
    if (nextTax == null) {
      setError("Enter a sales tax from 0 to 25, like 10.25. Use 0 to turn tax off.");
      return false;
    }
    const changes = items.filter((item) => draftChanged(item, drafts[item.id]));
    const taxChanged = nextTax !== Number(savedTax);
    if (changes.length === 0 && !taxChanged) return true;
    const rows: { id: string; section: MaterialPriceSection; unitCost: number | null; sheenCosts: Record<string, number> }[] = [];
    for (const item of changes) {
      const draft = drafts[item.id] ?? draftFromItem(item);
      if (item.section === "sundry") {
        const price = parsePriceInput(draft.unitCost);
        if (price === undefined) {
          setError(`Enter a price for ${item.name} like 12.50, or leave it blank.`);
          return false;
        }
        rows.push({ id: item.id, section: item.section, unitCost: price, sheenCosts: {} });
      } else {
        const sheenCosts: Record<string, number> = {};
        for (const [sheen, raw] of Object.entries(draft.sheenCosts)) {
          const price = parsePriceInput(raw);
          if (price === undefined) {
            setError(`Enter a gallon price for ${item.name} ${sheen} like 12.50, or leave it blank.`);
            return false;
          }
          if (price != null) sheenCosts[sheen] = price;
        }
        rows.push({ id: item.id, section: item.section, unitCost: null, sheenCosts });
      }
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const updated = rows.length ? await saveMaterialPrices(rows) : 0;
      const savedTaxPercent = taxChanged ? await saveMaterialTax(nextTax) : nextTax;
      const savedById = new Map(rows.map((row) => [row.id, row]));
      acceptDrafts.current = true;
      setSaveGeneration((current) => current + 1);
      setSavedTax(String(savedTaxPercent));
      setTaxPercent(String(savedTaxPercent));
      setItems((current) => current.map((item) => {
        const saved = savedById.get(item.id);
        if (!saved) return item;
        if (item.section === "sundry") return { ...item, unitCost: saved.unitCost };
        return { ...item, sheenCosts: saved.sheenCosts };
      }));
      setDrafts((current) => {
        const next = { ...current };
        for (const row of rows) {
          const draft = next[row.id] ?? { unitCost: "", sheenCosts: {} };
          if (row.section === "sundry") {
            next[row.id] = { ...draft, unitCost: moneyInput(row.unitCost) };
          } else {
            const sheenCosts = { ...draft.sheenCosts };
            for (const sheen of Object.keys(sheenCosts)) sheenCosts[sheen] = moneyInput(row.sheenCosts[sheen]);
            next[row.id] = { ...draft, sheenCosts };
          }
        }
        return next;
      });
      const notes = [
        updated ? `Saved ${updated} ${updated === 1 ? "price" : "prices"}.` : "",
        taxChanged ? `Sales tax is ${savedTaxPercent}%.` : "",
      ].filter(Boolean);
      setStatus(notes.join(" "));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save material prices.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [drafts, items, readOnly, savedTax, taxPercent]);

  const discard = useCallback(() => {
    const next: Record<string, MaterialPriceDraft> = {};
    for (const item of items) next[item.id] = draftFromItem(item);
    setDrafts(next);
    setTaxPercent(savedTax);
    setPaste("");
    setError(null);
    setStatus(null);
  }, [items, savedTax]);

  useEffect(() => {
    onBindActions?.({ save: persist, discard, getIsDirty });
  }, [discard, getIsDirty, onBindActions, persist]);

  function applyPaste() {
    const pasted = parsePricePaste(paste);
    if (pasted.length === 0) {
      setError("Paste product ID and price, one item per line.");
      return;
    }
    const bySku = new Map<string, MaterialPriceItem[]>();
    for (const item of filtered) {
      const sku = item.productId.trim().toLowerCase();
      if (!sku) continue;
      const list = bySku.get(sku) ?? [];
      list.push(item);
      bySku.set(sku, list);
    }
    const missing: string[] = [];
    const updates: { id: string; price: string }[] = [];
    for (const row of pasted) {
      const hits = bySku.get(row.productId.trim().toLowerCase()) ?? [];
      if (hits.length === 0) {
        missing.push(row.productId);
        continue;
      }
      for (const item of hits) {
        if (item.section === "sundry") updates.push({ id: item.id, price: row.price });
      }
    }
    setDrafts((current) => {
      const next = { ...current };
      for (const update of updates) {
        const draft = next[update.id] ?? { unitCost: "", sheenCosts: {} };
        next[update.id] = { ...draft, unitCost: update.price };
      }
      return next;
    });
    setError(null);
    const missed = missing.slice(0, 6).join(", ");
    setStatus(
      updates.length
        ? `Matched ${updates.length} ${updates.length === 1 ? "price" : "prices"}${missing.length ? `. Not in this list: ${missed}${missing.length > 6 ? "…" : ""}` : ". Review them, then save."}`
        : `None of those product IDs are in this list${missed ? `: ${missed}` : "."}`,
    );
  }

  function setUnit(id: string, unitCost: string) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { unitCost: "", sheenCosts: {} }), unitCost },
    }));
    setStatus(null);
  }

  function setSheen(id: string, sheen: string, value: string) {
    setDrafts((current) => {
      const draft = current[id] ?? { unitCost: "", sheenCosts: {} };
      return { ...current, [id]: { ...draft, sheenCosts: { ...draft.sheenCosts, [sheen]: value } } };
    });
    setStatus(null);
  }

  return (
    <div className="stack material-prices">
      <div>
        <h2 className="material-prices-title">Material prices</h2>
        <p className="muted small">
          Vendor prices are before tax. This sales tax is added when a job orders paint or sundries. Type a price in the list, or paste product ID and price.
        </p>
      </div>
      <label className="material-prices-tax">
        <span>Sales tax</span>
        <input
          inputMode="decimal"
          aria-label="Sales tax percent"
          value={taxPercent}
          disabled={readOnly || loading}
          onChange={(event) => {
            setTaxPercent(event.target.value);
            setStatus(null);
          }}
        />
        <span>%</span>
      </label>
      <div className="material-prices-switch" role="tablist" aria-label="Price list">
        <button type="button" className={section === "sundry" ? "btn btn-primary" : "btn"} onClick={() => { setSection("sundry"); setCategory(""); }}>
          Sundries
        </button>
        <button type="button" className={section === "paint_product" ? "btn btn-primary" : "btn"} onClick={() => { setSection("paint_product"); setCategory(""); }}>
          Paint
        </button>
      </div>
      <div className="material-prices-vendors" role="group" aria-label="Vendor">
        <button type="button" className={vendor === "" ? "btn btn-primary" : "btn"} onClick={() => { setVendor(""); setCategory(""); }}>
          All
        </button>
        {vendors.names.map((name) => (
          <button key={name} type="button" className={vendor === name ? "btn btn-primary" : "btn"} onClick={() => { setVendor(name); setCategory(""); }}>
            {name}
          </button>
        ))}
        {vendors.open ? (
          <button type="button" className={vendor === OPEN_VENDOR ? "btn btn-primary" : "btn"} onClick={() => { setVendor(OPEN_VENDOR); setCategory(""); }}>
            All vendors
          </button>
        ) : null}
      </div>
      <div className="material-prices-tools">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or product ID"
          aria-label="Search prices"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      {section === "sundry" ? (
        <div className="material-prices-paste">
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={4}
            placeholder={"Product ID and price, one per line\n3M-2090-1    3.60"}
            aria-label="Paste product IDs and prices"
            disabled={readOnly}
          />
          <button type="button" className="btn" disabled={readOnly || saving} onClick={applyPaste}>
            Apply paste
          </button>
        </div>
      ) : null}
      {error ? <p className="material-prices-error">{error}</p> : null}
      {status ? <p className="muted small">{status}</p> : null}
      <div className="material-prices-meta">
        <span>{filtered.length} in this list</span>
        <span>
          {[dirtyItems.length ? `${dirtyItems.length} unsaved prices` : "", taxDirty ? "tax changed" : ""].filter(Boolean).join(" · ") || "No unsaved changes"}
        </span>
        <button type="button" className="btn btn-primary" disabled={readOnly || saving || (dirtyItems.length === 0 && !taxDirty)} onClick={() => void persist()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {loading ? <p className="muted">Loading prices…</p> : null}
      {!loading ? (
        <div className="material-prices-scroll">
          <table className="material-prices-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Product ID</th>
                <th>{section === "paint_product" ? "Gallon price by sheen" : "Each"}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const draft = drafts[item.id] ?? draftFromItem(item);
                const changed = draftChanged(item, draft);
                const sheens = Object.keys(draft.sheenCosts);
                return (
                  <tr key={item.id} className={changed ? "material-prices-changed" : undefined}>
                    <td>
                      <div className="material-prices-name">{item.name}</div>
                      <div className="muted small">{item.category || vendorLabel(vendor)}</div>
                    </td>
                    <td className="material-prices-sku">{item.productId || "—"}</td>
                    <td>
                      {section === "sundry" ? (
                        <input
                          inputMode="decimal"
                          aria-label={`${item.name} price`}
                          value={draft.unitCost}
                          disabled={readOnly}
                          onChange={(event) => setUnit(item.id, event.target.value)}
                        />
                      ) : sheens.length === 0 ? (
                        <span className="muted small">No sheens on this product</span>
                      ) : (
                        <div className="material-prices-sheens">
                          {sheens.map((sheen) => (
                            <label key={sheen}>
                              <span>{sheen}</span>
                              <input
                                inputMode="decimal"
                                aria-label={`${item.name} ${sheen} price`}
                                value={draft.sheenCosts[sheen] ?? ""}
                                disabled={readOnly}
                                onChange={(event) => setSheen(item.id, sheen, event.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > visible.length ? (
            <p className="muted small">Showing {visible.length} of {filtered.length}. Search or pick a category to see the rest.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
