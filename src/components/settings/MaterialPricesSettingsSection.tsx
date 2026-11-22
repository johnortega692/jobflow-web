import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  addMaterialPriceItem,
  listSundryCategories,
  draftFromItem,
  getMaterialTax,
  listMaterialPrices,
  moneyInput,
  parsePriceInput,
  parsePricePaste,
  parseTaxPercent,
  saveMaterialAkas,
  saveMaterialPrices,
  saveMaterialTax,
  type MaterialPriceDraft,
  type MaterialPriceItem,
  type MaterialPriceSection,
} from "../../lib/materialPrices";
import { compareInvoiceLines, invoiceComparePrice, invoiceLineKey, invoiceLinkChoices, invoiceSheenKey, type InvoiceCompareRow } from "../../lib/invoiceReaders/compareInvoice";
import { invoiceReaderChoices, readVendorInvoice } from "../../lib/invoiceReaders/readInvoice";
import { foundationGridText } from "../../lib/invoiceReaders/foundationGrid";
import { ecoFeeAmount, formatTaxPercent, paintFeeAmount } from "../../lib/invoiceReaders/invoiceCharges";
import { invoiceProductCode, type ParsedInvoice, type ParsedInvoiceFile } from "../../lib/invoiceReaders/types";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";

const OPEN_VENDOR = "__open__";

const PAINT_PRICE_COLUMNS = ["Flat", "Eggshell", "Semi-Gloss", "Gloss", "Primer"] as const;

function foldSheen(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

function invoiceRowRole(row: InvoiceCompareRow): "matched" | "differs" | "new" | "fee" {
  if (row.kind === "fee") return "fee";
  if (row.kind === "match" && row.samePrice) return "matched";
  if (row.kind === "match") return "differs";
  return "new";
}

function invoiceSubline(row: InvoiceCompareRow): string {
  if (row.kind === "fee") return "Fee";
  const parts = [row.line.section === "paint_product" ? "Paint" : "Sundry"];
  const code = invoiceProductCode(row.line);
  if (code) parts.push(code);
  if (row.line.discountPercent != null) parts.push(`${row.line.discountPercent}% off $${row.line.listPrice.toFixed(2)}`);
  let text = parts.join(" · ");
  if (row.kind === "match" && row.item) text += ` → ${row.item.name}`;
  return text;
}

function invoicePageLabel(invoice: ParsedInvoice): string {
  if (invoice.firstPage === invoice.lastPage) return `Page ${invoice.firstPage} of ${invoice.pageCount}`;
  return `Pages ${invoice.firstPage}–${invoice.lastPage} of ${invoice.pageCount}`;
}

function knownAlias(item: { name: string; akas?: string[] }, alias: string): boolean {
  const key = alias.trim().toLowerCase();
  if (!key) return true;
  if (item.name.trim().toLowerCase() === key) return true;
  return (item.akas ?? []).some((name) => name.trim().toLowerCase() === key);
}

function sheenField(costs: Record<string, string>, label: string): string | null {
  const want = foldSheen(label);
  return Object.keys(costs).find((key) => foldSheen(key) === want) ?? null;
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pricePane, setPricePane] = useState<"prices" | "invoice">("prices");
  const [invoiceReader, setInvoiceReader] = useState(
    vendor === "Dunn Edwards" ? "dunn-edwards" : vendor === "PPG Paints" ? "ppg" : "sherwin-williams",
  );
  const [perGallon, setPerGallon] = useState(true);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const [invoiceReading, setInvoiceReading] = useState(false);
  const [invoice, setInvoice] = useState<ParsedInvoiceFile | null>(null);
  const [forcedMatch, setForcedMatch] = useState<Record<string, string>>({});
  const [linkQuery, setLinkQuery] = useState<{ key: string; text: string } | null>(null);
  const [taxPercent, setTaxPercent] = useState("10.25");
  const [savedTax, setSavedTax] = useState("10.25");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveGeneration, setSaveGeneration] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addSection, setAddSection] = useState<MaterialPriceSection>("sundry");
  const [addSheen, setAddSheen] = useState("");
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [addVendor, setAddVendor] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addAkas, setAddAkas] = useState("");
  const [addAliasSeed, setAddAliasSeed] = useState("");
  const [addInvoiceKey, setAddInvoiceKey] = useState<string | null>(null);
  const [sundryCategories, setSundryCategories] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [akaItem, setAkaItem] = useState<MaterialPriceItem | null>(null);
  const [akaText, setAkaText] = useState("");
  const [akaSaving, setAkaSaving] = useState(false);
  const [infoItem, setInfoItem] = useState<MaterialPriceItem | null>(null);
  const [actionMenu, setActionMenu] = useState<{ key: string; top: number; right: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
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
    if (!addOpen && !akaItem && !infoItem && !linkQuery && !actionMenu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || adding || akaSaving) return;
      if (actionMenu) setActionMenu(null);
      else if (linkQuery) setLinkQuery(null);
      else if (infoItem) setInfoItem(null);
      else if (akaItem) setAkaItem(null);
      else setAddOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actionMenu, addOpen, adding, akaItem, akaSaving, infoItem, linkQuery]);

  useLayoutEffect(() => {
    const menu = actionMenuRef.current;
    if (!actionMenu || !menu) return;
    const button = document.querySelector(`[data-invoice-action="${CSS.escape(actionMenu.key)}"]`);
    if (!(button instanceof HTMLElement)) return;
    const rect = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    const footer = document.querySelector(".material-prices-meta");
    const footerTop = footer instanceof HTMLElement ? footer.getBoundingClientRect().top : window.innerHeight;
    const limit = Math.min(window.innerHeight, footerTop) - 8;
    const openUp = rect.bottom + 4 + height > limit && rect.top - height - 4 >= 8;
    const top = openUp ? rect.top - height - 4 : rect.bottom + 4;
    const right = Math.max(8, window.innerWidth - rect.right);
    if (Math.abs(top - actionMenu.top) > 1 || Math.abs(right - actionMenu.right) > 1) {
      setActionMenu({ key: actionMenu.key, top, right });
    }
  }, [actionMenu]);

  useEffect(() => {
    if (!actionMenu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (actionMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-invoice-action]")) return;
      setActionMenu(null);
    }
    function onScroll() {
      setActionMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [actionMenu]);

  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }

  useEffect(() => {
    if (readOnly) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void Promise.all([listMaterialPrices(), getMaterialTax(), listSundryCategories().catch(() => [] as string[])])
      .then(([next, tax, categories]) => {
        if (cancelled) return;
        const nextDrafts: Record<string, MaterialPriceDraft> = {};
        for (const item of next) nextDrafts[item.id] = draftFromItem(item);
        const taxText = String(tax);
        setItems(next);
        setDrafts(nextDrafts);
        setSundryCategories(categories);
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

  const addCategoryNames = useMemo(() => {
    const names = new Set<string>();
    if (addSection === "sundry") {
      for (const name of sundryCategories) {
        const trimmed = name.trim();
        if (trimmed) names.add(trimmed);
      }
    }
    for (const item of items) {
      if (item.section !== addSection || !item.category.trim()) continue;
      names.add(item.category.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [addSection, items, sundryCategories]);

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
        return `${item.name} ${(item.akas ?? []).join(" ")} ${item.productId} ${item.category}`.toLowerCase().includes(query);
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

  function refreshSundryCategories() {
    void listSundryCategories().then(setSundryCategories).catch(() => undefined);
  }

  function openAdd() {
    setAddInvoiceKey(null);
    refreshSundryCategories();
    setAddSection(section);
    setAddSheen("");
    setAddName("");
    setAddCategory("");
    setAddProductId("");
    setAddPrice("");
    setAddAkas("");
    setAddAliasSeed("");
    setAddVendor(vendor === OPEN_VENDOR ? "" : vendor);
    setAddOpen(true);
    setError(null);
    setStatus(null);
  }

  function openInvoiceAdd(row: InvoiceCompareRow, key: string) {
    if (!invoice) return;
    refreshSundryCategories();
    setAddInvoiceKey(key);
    setLinkQuery(null);
    setAddSection(row.line.section);
    setAddSheen(row.line.sheen ?? "");
    setAddName(row.line.description);
    setAddCategory(row.line.section === "paint_product" ? invoice.vendorName : "");
    setAddProductId(invoiceProductCode(row.line));
    setAddPrice(invoiceComparePrice(row.line, perGallon).toFixed(2));
    setAddAkas("");
    setAddAliasSeed(row.line.description);
    setAddVendor(invoice.vendorName);
    setAddOpen(true);
    setError(null);
    setStatus(null);
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (readOnly || adding || !addName.trim()) return;
    if (addSection === "sundry" && !addCategory.trim()) {
      showToast("Choose a category so this sundry shows up in Field Tools ordering.");
      return;
    }
    setAdding(true);
    setError(null);
    setStatus(null);
    try {
      const created = await addMaterialPriceItem({
        section: addSection,
        name: addName,
        category: addCategory,
        productId: addProductId,
        vendorName: addVendor,
        unitCost: addSection === "sundry" ? addPrice : "",
      });
      const aliases = addAkas.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const seed = addAliasSeed.trim();
      if (seed && seed.toLowerCase() !== addName.trim().toLowerCase() && !aliases.some((alias) => alias.toLowerCase() === seed.toLowerCase())) {
        aliases.unshift(seed);
      }
      const akas = aliases.length ? await saveMaterialAkas(created.id, aliases) : created.akas;
      const saved = { ...created, akas };
      setItems((current) => [...current, saved]);
      setDrafts((current) => ({ ...current, [saved.id]: draftFromItem(saved) }));
      if (created.section === "paint_product" && addSheen.trim() && addPrice.trim()) {
        setSheen(created.id, addSheen.trim(), addPrice.trim());
      }
      if (saved.vendorNames.length === 0) setVendor(OPEN_VENDOR);
      else if (!itemMatchesVendor(saved, vendor)) setVendor(saved.vendorNames[0] ?? "");
      setCategory("");
      setSearch(saved.name);
      if (addInvoiceKey) setForcedMatch((current) => ({ ...current, [addInvoiceKey]: saved.id }));
      setAddOpen(false);
      setStatus(
        created.section === "paint_product" && addPrice.trim()
          ? `Added ${saved.name}. Save to keep the gallon price.`
          : `Added ${saved.name}.`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not add that item.";
      const existing = existingCatalogItem(message);
      if (existing && addInvoiceKey) {
        setForcedMatch((current) => ({ ...current, [addInvoiceKey]: existing.id }));
        const price = addPrice.trim();
        if (existing.section === "sundry" && price) setUnit(existing.id, price);
        else if (existing.section === "paint_product" && addSheen.trim() && price) setSheen(existing.id, addSheen.trim(), price);
        setAddOpen(false);
        setError(null);
        setStatus(`${existing.name} is already in the catalog. This invoice line now uses it.`);
      } else {
        setError(message);
      }
    } finally {
      setAdding(false);
    }
  }

  function existingCatalogItem(message: string): MaterialPriceItem | undefined {
    const name = addName.trim().toLowerCase();
    const category = addCategory.trim().toLowerCase();
    const productId = addProductId.trim().toLowerCase();
    if (message === "That item is already in the catalog.") {
      return items.find((item) => item.section === addSection && item.name.trim().toLowerCase() === name && item.category.trim().toLowerCase() === category);
    }
    if (message === "That product ID is already used." && productId) {
      return items.find((item) => item.section === addSection && item.productId.trim().toLowerCase() === productId);
    }
    return undefined;
  }

  function openAkaEditor(item: MaterialPriceItem) {
    setAkaItem(item);
    setAkaText(item.akas.join("\n"));
    setError(null);
  }

  async function saveAkaEditor(event: FormEvent) {
    event.preventDefault();
    if (readOnly || akaSaving || !akaItem) return;
    setAkaSaving(true);
    setError(null);
    try {
      const akas = await saveMaterialAkas(akaItem.id, akaText.split(/\r?\n/));
      setItems((current) => current.map((item) => item.id === akaItem.id ? { ...item, akas } : item));
      setAkaItem(null);
      setStatus(`Saved AKAs for ${akaItem.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save those AKAs.");
    } finally {
      setAkaSaving(false);
    }
  }

  const invoiceGroups = useMemo(
    () => (invoice
      ? invoice.invoices.map((entry) => ({
          invoice: entry,
          rows: compareInvoiceLines(entry.lines, items, drafts, entry.vendorName, forcedMatch, entry.invoiceNo, perGallon),
        }))
      : []),
    [drafts, forcedMatch, invoice, items, perGallon],
  );
  const invoiceRows = invoiceGroups.flatMap((group) => group.rows);
  const invoiceMatchCount = invoiceRows.filter((row) => invoiceRowRole(row) === "matched").length;
  const invoiceDifferCount = invoiceRows.filter((row) => invoiceRowRole(row) === "differs").length;
  const invoiceNewRows = invoiceRows.filter((row) => invoiceRowRole(row) === "new");
  const linkTarget = (() => {
    if (!linkQuery) return null;
    for (const group of invoiceGroups) {
      const index = group.rows.findIndex((row, rowIndex) => invoiceLineKey(row.line, rowIndex, group.invoice.invoiceNo) === linkQuery.key);
      if (index < 0) continue;
      return { row: group.rows[index]!, key: linkQuery.key, text: linkQuery.text };
    }
    return null;
  })();
  const linkChoices = linkTarget && invoice
    ? invoiceLinkChoices(items, invoice.vendorName, linkTarget.row.line.section, linkTarget.text)
    : [];

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setStatus(`Copied ${label}.`);
    } catch {
      setError("Could not copy. Allow clipboard access and try again.");
    }
  }

  async function copyFoundation() {
    if (!invoice) return;
    const lines = invoice.invoices.flatMap((entry) => entry.lines);
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(foundationGridText(lines));
      const fees = lines.filter((line) => line.catalogItem === false).length;
      setError(null);
      setStatus(`Copied ${lines.length} rows. In Foundation, click the first Description cell and paste.${fees ? ` Includes ${fees} ${fees === 1 ? "fee" : "fees"}.` : ""}`);
    } catch {
      setError("Could not copy those rows. Allow clipboard access and try again.");
    }
  }

  function revealItem(item: MaterialPriceItem) {
    setSection(item.section);
    setCategory("");
    setSearch(item.name);
    if (item.vendorNames.length === 0) setVendor(OPEN_VENDOR);
    else if (!itemMatchesVendor(item, vendor)) setVendor(item.vendorNames[0] ?? "");
  }

  async function readInvoice(file: File) {
    setInvoiceReading(true);
    setError(null);
    setStatus(null);
    try {
      const parsed = await readVendorInvoice(await file.arrayBuffer(), invoiceReader);
      setInvoice(parsed);
      setForcedMatch({});
      setLinkQuery(null);
      const lineCount = parsed.invoices.reduce((sum, entry) => sum + entry.lines.length, 0);
      const invoiceCount = parsed.invoices.length;
      setStatus(`${parsed.vendorName}: ${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"}, ${lineCount} priced ${lineCount === 1 ? "line" : "lines"}.`);
    } catch (e) {
      setInvoice(null);
      setError(e instanceof Error ? e.message : "Could not read that invoice.");
    } finally {
      setInvoiceReading(false);
    }
  }

  async function linkFoundItem(row: InvoiceCompareRow, choice: MaterialPriceItem, key: string) {
    if (readOnly || akaSaving) return;
    setForcedMatch((current) => ({ ...current, [key]: choice.id }));
    setLinkQuery(null);
    const price = invoiceComparePrice(row.line, perGallon).toFixed(2);
    let priced = false;
    if (choice.section === "sundry") {
      setUnit(choice.id, price);
      priced = true;
    } else {
      const sheen = invoiceSheenKey(choice, drafts[choice.id], row.line.sheen);
      if (sheen) {
        setSheen(choice.id, sheen, price);
        priced = true;
      } else {
        setError(`${choice.name} has more than one sheen, and that invoice line does not name one.`);
      }
    }
    revealItem(choice);
    const alias = row.line.description.trim();
    const priceNote = priced ? `Invoice price for ${choice.name} is in the list. Save to keep it.` : "";
    if (priceNote) setStatus(priceNote);
    if (!alias || knownAlias(choice, alias)) return;
    setAkaSaving(true);
    setError((current) => priced ? null : current);
    try {
      const akas = await saveMaterialAkas(choice.id, [...(choice.akas ?? []), alias]);
      setItems((current) => current.map((item) => item.id === choice.id ? { ...item, akas } : item));
      setStatus(priced
        ? `Invoice price for ${choice.name} is in the list. Saved “${alias}” as an AKA. Save to keep the price.`
        : `Saved “${alias}” as an AKA for ${choice.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that AKA.");
      if (priceNote) setStatus(priceNote);
    } finally {
      setAkaSaving(false);
    }
  }

  function applyInvoicePrice(row: InvoiceCompareRow) {
    if (!row.item) return;
    const price = invoiceComparePrice(row.line, perGallon).toFixed(2);
    if (row.item.section === "sundry") setUnit(row.item.id, price);
    else if (row.sheenKey) setSheen(row.item.id, row.sheenKey, price);
    else {
      setError(`${row.item.name} has more than one sheen, and that invoice line does not name one.`);
      return;
    }
    revealItem(row.item);
    setStatus(`Invoice price for ${row.item.name} is in the list. Save to keep it.`);
  }

  function openInvoiceFind(key: string) {
    setActionMenu(null);
    setInfoItem(null);
    setLinkQuery({ key, text: "" });
  }

  function unlinkInvoiceRow(key: string) {
    setActionMenu(null);
    setForcedMatch((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const unsavedLabel =
    [dirtyItems.length ? `${dirtyItems.length} unsaved prices` : "", taxDirty ? "tax changed" : ""].filter(Boolean).join(" · ") ||
    "No unsaved changes";

  return (
    <div className="stack material-prices">
      <div className="settings-subtabs" role="tablist" aria-label="Material prices">
        <button
          type="button"
          role="tab"
          className={`settings-subtab${pricePane === "prices" ? " is-on" : ""}`}
          aria-selected={pricePane === "prices"}
          onClick={() => setPricePane("prices")}
        >
          Prices
        </button>
        <button
          type="button"
          role="tab"
          className={`settings-subtab${pricePane === "invoice" ? " is-on" : ""}`}
          aria-selected={pricePane === "invoice"}
          onClick={() => setPricePane("invoice")}
        >
          Read invoice
        </button>
      </div>
      {pricePane === "prices" ? (
      <>
      <div className="material-prices-bar">
        <div className="material-prices-segment" role="tablist" aria-label="Price list">
          <button
            type="button"
            role="tab"
            aria-selected={section === "sundry"}
            className={section === "sundry" ? "is-on" : undefined}
            onClick={() => { setSection("sundry"); setCategory(""); }}
          >
            Sundries
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "paint_product"}
            className={section === "paint_product" ? "is-on" : undefined}
            onClick={() => { setSection("paint_product"); setCategory(""); }}
          >
            Paint
          </button>
        </div>
        <select
          className="material-prices-vendor"
          value={vendor}
          aria-label="Vendor"
          onChange={(event) => {
            setVendor(event.target.value);
            setCategory("");
          }}
        >
          <option value="">All</option>
          {vendors.names.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          {vendors.open ? <option value={OPEN_VENDOR}>All vendors</option> : null}
        </select>
        <span className="material-prices-bar-spacer" />
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
        <button
          type="button"
          className="btn"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          Paste prices
        </button>
        <button type="button" className="btn btn-primary" disabled={readOnly || loading || addOpen} onClick={openAdd}>
          {section === "sundry" ? "+ Add sundry" : "+ Add paint"}
        </button>
      </div>
      {pasteOpen ? (
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
      </>
      ) : (
      <div className="material-prices-invoice-pane">
        <div className="material-prices-invoice-head">
          <p className="muted small">Pick the vendor, then choose that vendor's invoice PDF.</p>
          <div className="material-prices-invoice-actions">
            <select
              value={invoiceReader}
              aria-label="Invoice vendor"
              disabled={readOnly || invoiceReading}
              onChange={(event) => {
                setInvoiceReader(event.target.value);
                setInvoice(null);
                setLinkQuery(null);
                setForcedMatch({});
              }}
            >
              {invoiceReaderChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.vendorName}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              disabled={readOnly || loading || invoiceReading}
              onClick={() => invoiceInputRef.current?.click()}
            >
              {invoiceReading ? "Reading invoice…" : "Choose PDF"}
            </button>
            {invoice ? (
              <button
                type="button"
                className="btn material-prices-clear"
                aria-label="Clear results"
                title="Clear results"
                onClick={() => { setInvoice(null); setLinkQuery(null); }}
              >
                ✕
              </button>
            ) : null}
          </div>
          <input
            ref={invoiceInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            aria-label="Vendor invoice PDF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readInvoice(file);
            }}
          />
        </div>
      {invoice ? (
        <section className="material-prices-invoice" aria-label="Invoice comparison">
          <div className="material-prices-invoice-head material-prices-invoice-summary">
            <strong>{invoice.vendorName} {invoice.invoices.length === 1 ? "invoice" : `${invoice.invoices.length} invoices`}</strong>
            <span className="muted small">
              {invoiceMatchCount} match
              {" · "}
              {invoiceDifferCount} differ
              {" · "}
              {invoiceNewRows.length} not in catalog
            </span>
            <button type="button" className="btn" onClick={() => void copyFoundation()}>Copy for Foundation</button>
          </div>
          <div className="material-prices-invoice-head">
            <div className="material-prices-segment" role="group" aria-label="Invoice price unit">
              <button type="button" className={perGallon ? "is-on" : undefined} aria-pressed={perGallon} onClick={() => setPerGallon(true)}>1 gal</button>
              <button type="button" className={perGallon ? undefined : "is-on"} aria-pressed={!perGallon} onClick={() => setPerGallon(false)}>As invoiced</button>
            </div>
          </div>
          <div className="material-prices-invoice-scroll">
            <table className="material-prices-table material-prices-invoice-table">
              <thead>
                <tr>
                  <th>Invoice line</th>
                  <th className="material-prices-money">Price</th>
                  <th className="material-prices-invoice-action" aria-hidden="true"><div className="material-prices-invoice-action-slot" /></th>
                </tr>
              </thead>
              <tbody>
                {invoiceGroups.map((group, groupIndex) => (
                  <Fragment key={`${groupIndex}-${group.invoice.invoiceNo}-${group.invoice.firstPage}`}>
                    <tr className="material-prices-invoice-break">
                      <td colSpan={3}>
                        <div className="material-prices-invoice-id">
                          <strong>{group.invoice.invoiceNo ? `#${group.invoice.invoiceNo}` : "Invoice"}</strong>
                          {group.invoice.invoiceNo ? (
                            <button
                              type="button"
                              className="material-prices-copy"
                              aria-label={`Copy invoice ${group.invoice.invoiceNo}`}
                              title="Copy invoice number"
                              onClick={() => void copyText(group.invoice.invoiceNo, group.invoice.invoiceNo)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          ) : null}
                          <span className="muted small">{[group.invoice.invoiceDate, invoicePageLabel(group.invoice)].filter(Boolean).join(" · ")}</span>
                        </div>
                        <div className="material-prices-invoice-charges">
                          <span>Total {group.invoice.total == null ? "—" : `$${group.invoice.total.toFixed(2)}`}</span>
                          <span>Paint fee ${paintFeeAmount(group.invoice.lines).toFixed(2)}</span>
                          <span>Eco fee ${ecoFeeAmount(group.invoice.lines).toFixed(2)}</span>
                          <span>Tax {group.invoice.taxPercent == null ? "—" : formatTaxPercent(group.invoice.taxPercent)}</span>
                        </div>
                      </td>
                    </tr>
                {group.rows.map((row, index) => {
                  const key = invoiceLineKey(row.line, index, group.invoice.invoiceNo);
                  const role = invoiceRowRole(row);
                  const comparePrice = invoiceComparePrice(row.line, perGallon);
                  const linked = Boolean(forcedMatch[key]);
                  return (
                    <tr key={key}>
                      <td className="material-prices-invoice-line">
                        <div className="material-prices-copy-line">
                          <div className="material-prices-name">{row.line.description}</div>
                          <button
                            type="button"
                            className="material-prices-copy"
                            aria-label={`Copy ${row.line.description}`}
                            title="Copy description"
                            onClick={() => void copyText(row.line.description, row.line.description)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                        <div className="material-prices-invoice-sub">
                          <span className="material-prices-invoice-sub-text">{invoiceSubline(row)}</span>
                          {role === "matched" ? <span className="material-prices-pill is-match">✓</span> : null}
                          {role === "differs" ? <span className="material-prices-pill is-differ">Differs</span> : null}
                          {role === "new" ? <span className="material-prices-pill">New</span> : null}
                        </div>
                      </td>
                      <td className="material-prices-money">
                        <span className="material-prices-money-copy">
                          <strong>${comparePrice.toFixed(2)}</strong>
                          <button
                            type="button"
                            className="material-prices-copy"
                            aria-label={`Copy invoice unit cost ${row.line.netPrice.toFixed(2)}`}
                            title="Copy invoice unit cost"
                            onClick={() => void copyText(row.line.netPrice.toFixed(2), `$${row.line.netPrice.toFixed(2)}`)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </span>
                        {role === "matched" ? <div className="material-prices-price-note">same as catalog</div> : null}
                        {role === "differs" ? (
                          <div className="material-prices-price-note is-differ">
                            was {row.catalogPrice == null ? "—" : `$${row.catalogPrice.toFixed(2)}`}
                          </div>
                        ) : null}
                        {role === "new" ? <div className="material-prices-price-note">not in catalog</div> : null}
                      </td>
                      <td className="material-prices-invoice-action">
                        {role === "fee" ? <div className="material-prices-invoice-action-slot" /> : null}
                        {role === "new" ? (
                          <button type="button" className="btn btn-primary" disabled={readOnly || addOpen} onClick={() => openInvoiceAdd(row, key)}>Add</button>
                        ) : null}
                        {role === "fee" ? null : (
                          <button
                            type="button"
                            className={`btn material-prices-icon-btn${actionMenu?.key === key ? " is-on" : ""}`}
                            data-invoice-action={key}
                            aria-label={`Actions for ${row.line.description}`}
                            aria-haspopup="menu"
                            aria-expanded={actionMenu?.key === key}
                            title="Actions"
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setActionMenu((current) => current?.key === key ? null : {
                                key,
                                top: rect.bottom + 4,
                                right: Math.max(8, window.innerWidth - rect.right),
                              });
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <circle cx="12" cy="5" r="1.7" />
                              <circle cx="12" cy="12" r="1.7" />
                              <circle cx="12" cy="19" r="1.7" />
                            </svg>
                          </button>
                        )}
                        {role !== "fee" && actionMenu?.key === key ? createPortal(
                          <div
                            ref={actionMenuRef}
                            className="material-prices-menu"
                            role="menu"
                            style={{ top: actionMenu.top, right: actionMenu.right }}
                          >
                            {role === "differs" ? (
                              <>
                                <button type="button" role="menuitem" disabled={readOnly} onClick={() => { setActionMenu(null); applyInvoicePrice(row); }}>Apply</button>
                                <button type="button" role="menuitem" disabled={readOnly || addOpen} onClick={() => { setActionMenu(null); openInvoiceAdd(row, key); }}>Add</button>
                                <button type="button" role="menuitem" onClick={() => openInvoiceFind(key)}>Find item</button>
                              </>
                            ) : null}
                            {role === "new" ? (
                              <button type="button" role="menuitem" onClick={() => openInvoiceFind(key)}>Link to existing item…</button>
                            ) : null}
                            {role === "matched" ? (
                              <button type="button" role="menuitem" onClick={() => openInvoiceFind(key)}>Change match…</button>
                            ) : null}
                            {role === "matched" || (role === "differs" && linked) ? (
                              <button type="button" role="menuitem" onClick={() => unlinkInvoiceRow(key)}>Unlink</button>
                            ) : null}
                          </div>,
                          document.body,
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      </div>
      )}
      {pricePane === "prices" ? (
      <>
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
      {loading ? <p className="muted">Loading prices…</p> : null}
      {!loading ? (
        <div className="material-prices-scroll">
          <table className="material-prices-table">
            <thead>
              {section === "sundry" ? (
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Product ID</th>
                  <th className="material-prices-money">Each</th>
                </tr>
              ) : (
                <tr>
                  <th>Product</th>
                  {PAINT_PRICE_COLUMNS.map((label) => (
                    <th key={label} className="material-prices-money">{label}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {visible.map((item) => {
                const draft = drafts[item.id] ?? draftFromItem(item);
                const changed = draftChanged(item, draft);
                return (
                  <tr key={item.id} className={changed ? "material-prices-changed" : undefined}>
                    <td>
                      <div className="material-prices-name">{item.name}</div>
                      <button type="button" className="material-prices-aka" disabled={readOnly} onClick={() => openAkaEditor(item)}>
                        {(item.akas ?? []).length ? `AKA: ${(item.akas ?? []).join(", ")}` : "Add AKA"}
                      </button>
                    </td>
                    {section === "sundry" ? (
                      <>
                        <td className="material-prices-category">{item.category || "—"}</td>
                        <td className="material-prices-sku">{item.productId || "—"}</td>
                        <td className="material-prices-money">
                          <input
                            inputMode="decimal"
                            aria-label={`${item.name} price`}
                            value={draft.unitCost}
                            disabled={readOnly}
                            onChange={(event) => setUnit(item.id, event.target.value)}
                          />
                        </td>
                      </>
                    ) : (
                      PAINT_PRICE_COLUMNS.map((label) => {
                        const sheen = sheenField(draft.sheenCosts, label);
                        return (
                          <td key={label} className="material-prices-money">
                            {sheen == null ? (
                              <span className="material-prices-empty" aria-hidden>—</span>
                            ) : (
                              <input
                                inputMode="decimal"
                                aria-label={`${item.name} ${sheen} price`}
                                value={draft.sheenCosts[sheen] ?? ""}
                                disabled={readOnly}
                                onChange={(event) => setSheen(item.id, sheen, event.target.value)}
                              />
                            )}
                          </td>
                        );
                      })
                    )}
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
      </>
      ) : null}
      {addOpen
        ? createPortal(
            <div className="job-info-drawer-root" role="presentation">
              <button
                type="button"
                className="job-info-drawer-backdrop"
                aria-label="Close add item"
                disabled={adding}
                onClick={() => setAddOpen(false)}
              />
              <aside className="job-info-drawer-panel material-prices-add-panel" aria-labelledby="material-prices-add-title">
                <header className="job-info-drawer-header row-between">
                  <h2 id="material-prices-add-title">{addSection === "sundry" ? "Add sundry" : "Add paint"}</h2>
                  <button
                    type="button"
                    className="btn btn-ghost job-info-drawer-close"
                    disabled={adding}
                    onClick={() => setAddOpen(false)}
                  >
                    Close
                  </button>
                </header>
                <form className="material-prices-add" onSubmit={(event) => void submitAdd(event)}>
                  <label>
                    Name
                    <input
                      value={addName}
                      onChange={(event) => setAddName(event.target.value)}
                      placeholder="Name"
                      disabled={adding}
                      required
                      autoFocus
                    />
                  </label>
                  <label>
                    Also known as
                    <textarea
                      value={addAkas}
                      onChange={(event) => setAddAkas(event.target.value)}
                      placeholder={"One name per line\nPI DTM SG ULTRA"}
                      rows={3}
                      disabled={adding}
                    />
                  </label>
                  <label>
                    Category
                    <select
                      value={addCategory}
                      onChange={(event) => setAddCategory(event.target.value)}
                      disabled={adding}
                    >
                      <option value="">{addSection === "sundry" ? "Choose a category" : "No category"}</option>
                      {addCategoryNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Product ID
                    <input
                      value={addProductId}
                      onChange={(event) => setAddProductId(event.target.value)}
                      placeholder="Product ID"
                      disabled={adding}
                    />
                  </label>
                  <label>
                    Vendor
                    <select value={addVendor} onChange={(event) => setAddVendor(event.target.value)} disabled={adding}>
                      <option value="">All vendors</option>
                      {vendors.names.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  {addSection === "paint_product" ? (
                    <label>
                      Sheen
                      <input
                        value={addSheen}
                        onChange={(event) => setAddSheen(event.target.value)}
                        placeholder="Semi-Gloss"
                        disabled={adding}
                      />
                    </label>
                  ) : null}
                  <label>
                    {addSection === "sundry" ? "Each" : "Price"}
                    <input
                      value={addPrice}
                      onChange={(event) => setAddPrice(event.target.value)}
                      placeholder="12.50"
                      inputMode="decimal"
                      disabled={adding}
                    />
                  </label>
                  <div className="material-prices-add-actions">
                    <button type="submit" className="btn btn-primary" disabled={adding || !addName.trim()}>
                      {adding ? "Adding…" : "Add"}
                    </button>
                    <button type="button" className="btn" disabled={adding} onClick={() => setAddOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </aside>
            </div>,
            document.body,
          )
        : null}
      {akaItem
        ? createPortal(
            <div className="job-info-drawer-root" role="presentation">
              <button type="button" className="job-info-drawer-backdrop" aria-label="Close AKAs" disabled={akaSaving} onClick={() => setAkaItem(null)} />
              <aside className="job-info-drawer-panel material-prices-add-panel" aria-labelledby="material-prices-aka-title">
                <header className="job-info-drawer-header row-between">
                  <h2 id="material-prices-aka-title">AKAs for {akaItem.name}</h2>
                  <button type="button" className="btn btn-ghost job-info-drawer-close" disabled={akaSaving} onClick={() => setAkaItem(null)}>
                    Close
                  </button>
                </header>
                <form className="material-prices-add" onSubmit={(event) => void saveAkaEditor(event)}>
                  <label>
                    Also known as
                    <textarea
                      value={akaText}
                      onChange={(event) => setAkaText(event.target.value)}
                      placeholder={"One name per line\nPI DTM SG ULTRA\nPI DTM SG DEEP"}
                      rows={8}
                      disabled={akaSaving}
                      autoFocus
                    />
                  </label>
                  <p className="muted small">Sheen and tint-base names stay on this one product. The catalog name does not change.</p>
                  <div className="material-prices-add-actions">
                    <button type="submit" className="btn btn-primary" disabled={akaSaving}>{akaSaving ? "Saving…" : "Save"}</button>
                    <button type="button" className="btn" disabled={akaSaving} onClick={() => setAkaItem(null)}>Cancel</button>
                  </div>
                </form>
              </aside>
            </div>,
            document.body,
          )
        : null}
      {linkTarget
        ? createPortal(
            <div className="job-info-drawer-root" role="presentation">
              <button type="button" className="job-info-drawer-backdrop" aria-label="Close find item" disabled={akaSaving} onClick={() => setLinkQuery(null)} />
              <aside className="job-info-drawer-panel material-prices-add-panel" aria-labelledby="material-prices-find-title">
                <header className="job-info-drawer-header row-between">
                  <h2 id="material-prices-find-title">Find item</h2>
                  <button type="button" className="btn btn-ghost job-info-drawer-close" disabled={akaSaving} onClick={() => setLinkQuery(null)}>
                    Close
                  </button>
                </header>
                <div className="material-prices-find">
                  <p className="material-prices-name">{linkTarget.row.line.description}</p>
                  <p className="muted small">
                    {linkTarget.row.line.section === "paint_product" ? "Paint" : "Sundry"}
                    {invoice ? ` · ${invoice.vendorName}` : ""}
                  </p>
                  <div className="material-prices-link">
                    <input
                      value={linkTarget.text}
                      autoFocus
                      placeholder="Search name or product ID"
                      aria-label={`Find a catalog item for ${linkTarget.row.line.description}`}
                      onChange={(event) => setLinkQuery({ key: linkTarget.key, text: event.target.value })}
                    />
                    {linkTarget.text.trim().length < 2 ? <p className="muted small">Type at least 2 letters.</p> : null}
                    {linkChoices.length > 0 ? (
                      <ul className="material-prices-link-list">
                        {linkChoices.map((choice) => (
                          <li key={choice.id}>
                            <button
                              type="button"
                              disabled={readOnly || akaSaving}
                              onClick={() => {
                                const chosen = items.find((item) => item.id === choice.id);
                                if (chosen) void linkFoundItem(linkTarget.row, chosen, linkTarget.key);
                              }}
                            >
                              <span>{choice.name}</span>
                              <span className="muted small">{[choice.productId, choice.category].filter(Boolean).join(" · ")}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {linkTarget.text.trim().length >= 2 && linkChoices.length === 0 ? (
                      <p className="muted small">No catalog item with that name or product ID.</p>
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
      {infoItem
        ? createPortal(
            <div className="job-info-drawer-root" role="presentation">
              <button type="button" className="job-info-drawer-backdrop" aria-label="Close product" onClick={() => setInfoItem(null)} />
              <aside className="job-info-drawer-panel material-prices-add-panel" aria-labelledby="material-prices-info-title">
                <header className="job-info-drawer-header row-between">
                  <h2 id="material-prices-info-title">{infoItem.name}</h2>
                  <button type="button" className="btn btn-ghost job-info-drawer-close" onClick={() => setInfoItem(null)}>
                    Close
                  </button>
                </header>
                <dl className="material-prices-info">
                  <div>
                    <dt>Type</dt>
                    <dd>{infoItem.section === "paint_product" ? "Paint" : "Sundry"}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{infoItem.category || "—"}</dd>
                  </div>
                  <div>
                    <dt>Product ID</dt>
                    <dd>{infoItem.productId || "—"}</dd>
                  </div>
                  <div>
                    <dt>Vendor</dt>
                    <dd>{infoItem.vendorNames.length ? infoItem.vendorNames.join(", ") : "All vendors"}</dd>
                  </div>
                  <div>
                    <dt>Also known as</dt>
                    <dd>{infoItem.akas.length ? infoItem.akas.join(", ") : "—"}</dd>
                  </div>
                  {infoItem.section === "sundry" ? (
                    <div>
                      <dt>Each</dt>
                      <dd>{infoItem.unitCost == null ? "—" : `$${infoItem.unitCost.toFixed(2)}`}</dd>
                    </div>
                  ) : (
                    <div>
                      <dt>Sheen prices</dt>
                      <dd>
                        {(infoItem.sheens.length ? infoItem.sheens : Object.keys(infoItem.sheenCosts)).length === 0
                          ? "—"
                          : (infoItem.sheens.length ? infoItem.sheens : Object.keys(infoItem.sheenCosts)).map((sheen) => (
                            <span key={sheen} className="material-prices-info-price">
                              {sheen}
                              {" "}
                              {infoItem.sheenCosts[sheen] == null ? "—" : `$${infoItem.sheenCosts[sheen].toFixed(2)}`}
                            </span>
                          ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </aside>
            </div>,
            document.body,
          )
        : null}
      {error ? <p className="material-prices-error">{error}</p> : null}
      {toast ? createPortal(<div className="material-prices-toast" role="status">{toast}</div>, document.body) : null}
      <div className="material-prices-meta">
        <span>{pricePane === "prices" ? `${filtered.length} in this list` : status}</span>
        <div className="material-prices-meta-actions">
          {pricePane === "prices" && status ? <span>{status}</span> : null}
          <span>{unsavedLabel}</span>
          <button type="button" className="btn btn-primary" disabled={readOnly || saving || (dirtyItems.length === 0 && !taxDirty)} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
