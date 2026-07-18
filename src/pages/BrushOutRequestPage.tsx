import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { LinkBrushoutPrepModal } from "../components/brushout/LinkBrushoutPrepModal";
import { OpenBrushoutPrepModal } from "../components/brushout/OpenBrushoutPrepModal";
import { EmailVendorModal } from "../components/paint/EmailVendorModal";
import { PaintBulkAddModal } from "../components/paint/PaintBulkAddModal";
import { PaintItemRow } from "../components/paint/PaintItemRow";
import { PaintImageImport } from "../components/PaintImageImport";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  buildPrepRecord,
  linkBrushoutPrepToProject,
  listBrushoutPrepsSorted,
  loadBrushoutPreps,
  markPrepLinked,
  paintItemHasContent,
  prepPaintItems,
  saveBrushoutPreps,
  upsertPrepInList,
  type BrushoutPrepDraft,
} from "../lib/brushoutPrepStorage";
import {
  loadPaintColors,
  loadPaintProducts,
  loadPaintSheens,
  type PaintColorsDb,
  type PaintProduct,
} from "../lib/paintCatalog";
import type { ExtractedPaintRow } from "../lib/paintImageImport";
import { vendorDisplayName } from "../lib/paintVendorEmail";
import { loadPaintUserSettings } from "../lib/paintUserSettings";
import { emptyPaintItem, type PaintItem } from "../types/tradeDocuments";

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function emptyDraft(): BrushoutPrepDraft {
  return {
    prep_id: null,
    internal_reference: "",
    site_location: "",
    gc: "",
    paint_vendor: "",
    items: [emptyPaintItem()],
  };
}

function statusLine(draft: BrushoutPrepDraft): string {
  if (!draft.prep_id) return "Unsaved prep — enter reference fields and click Save prep.";
  const parts = [`Prep ${draft.prep_id}`];
  if (draft.internal_reference.trim()) parts.push(draft.internal_reference.trim());
  const lines = draft.items.filter(paintItemHasContent).length;
  parts.push(`(${lines} lines, ${draft.status ?? "open"})`);
  if (draft.linked_job_key) parts.push(`→ linked to project`);
  return parts.join(" · ");
}

export function BrushOutRequestPage() {
  const { user } = useAuth();
  const { branding } = useLetterhead();
  const [draft, setDraft] = useState<BrushoutPrepDraft>(emptyDraft);
  const [preps, setPreps] = useState<Awaited<ReturnType<typeof loadBrushoutPreps>>>([]);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const [colors, setColors] = useState<PaintColorsDb | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    void loadBrushoutPreps(user.id).then(setPreps);
    void loadPaintUserSettings(user.id).then((settings) => {
      setUserSettings(settings);
      setDraft((d) => ({
        ...d,
        paint_vendor: d.paint_vendor || (settings.vendors[0] ? vendorDisplayName(settings.vendors[0]) : ""),
      }));
    });
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const uid = user?.id ?? null;
        const [p, s, c] = await Promise.all([
          loadPaintProducts(uid),
          loadPaintSheens(uid),
          loadPaintColors(),
        ]);
        if (!cancelled) {
          setProducts(p);
          setSheens(s);
          setColors(c);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load paint catalogs");
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const sortedPreps = useMemo(() => listBrushoutPrepsSorted(preps), [preps]);
  const currentRecord = draft.prep_id ? preps.find((p) => p.prep_id === draft.prep_id) ?? null : null;

  function patchItem(index: number, patch: Partial<PaintItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onImported(rows: ExtractedPaintRow[]) {
    const mapped: PaintItem[] = rows.map((r) => ({
      label: r.label,
      floor: r.floor,
      manufacturer: r.manufacturer,
      color: r.color,
      product: r.product,
      sheen: r.sheen,
      previous_color: "",
    }));
    setDraft((d) => {
      const existing = d.items.filter(paintItemHasContent);
      const merged = [...existing, ...mapped];
      return { ...d, items: merged.length ? merged : [emptyPaintItem()] };
    });
    setError(null);
  }

  function newPrep() {
    const defaultVendor = userSettings?.vendors[0] ? vendorDisplayName(userSettings.vendors[0]) : "";
    setDraft({ ...emptyDraft(), paint_vendor: defaultVendor });
    setStatus(null);
    setError(null);
  }

  function loadPrep(prepId: string) {
    const prep = preps.find((p) => p.prep_id === prepId);
    if (!prep) {
      setError(`Prep ${prepId} not found.`);
      return;
    }
    const items = prepPaintItems(prep);
    setDraft({
      prep_id: prep.prep_id,
      internal_reference: prep.internal_reference ?? "",
      site_location: prep.site_location ?? "",
      gc: prep.gc ?? "",
      paint_vendor: prep.paint_vendor ?? (userSettings?.vendors[0] ? vendorDisplayName(userSettings.vendors[0]) : ""),
      items: items.length ? items : [emptyPaintItem()],
      status: prep.status,
      emailed_date: prep.emailed_date,
      linked_job_key: prep.linked_job_key,
      linked_at: prep.linked_at,
      created: prep.created,
    });
    setOpenModal(false);
    setStatus(`Opened ${prep.prep_id}.`);
    setError(null);
  }

  async function ensureSavedPrep(): Promise<{ prepId: string; nextPreps: typeof preps } | null> {
    if (!user?.id) return null;
    setSaving(true);
    setError(null);
    const { record, error: buildErr } = buildPrepRecord(draft, currentRecord, preps);
    if (buildErr) {
      setSaving(false);
      setError(buildErr);
      return null;
    }
    const nextPreps = upsertPrepInList(preps, record);
    const saveErr = await saveBrushoutPreps(user.id, nextPreps);
    setSaving(false);
    if (saveErr) {
      setError(saveErr);
      return null;
    }
    setPreps(nextPreps);
    setDraft((d) => ({
      ...d,
      prep_id: record.prep_id,
      status: record.status,
      emailed_date: record.emailed_date,
      linked_job_key: record.linked_job_key,
      linked_at: record.linked_at,
      created: record.created,
    }));
    return { prepId: record.prep_id, nextPreps };
  }

  async function savePrep() {
    const saved = await ensureSavedPrep();
    if (saved) setStatus(`Brush-out prep saved as ${saved.prepId}.`);
  }

  async function onLink(projectId: string, mergeMode: "append" | "replace") {
    if (!user?.id) return;
    const saved = await ensureSavedPrep();
    if (!saved) return;
    const prep = saved.nextPreps.find((p) => p.prep_id === saved.prepId) ?? buildPrepRecord(draft, currentRecord, preps).record;
    setSaving(true);
    const linkErr = await linkBrushoutPrepToProject(projectId, prep, mergeMode);
    if (linkErr) {
      setSaving(false);
      setError(linkErr);
      return;
    }
    const nextPreps = markPrepLinked(saved.nextPreps, saved.prepId, projectId);
    const saveErr = await saveBrushoutPreps(user.id, nextPreps);
    setSaving(false);
    if (saveErr) {
      setError(saveErr);
      return;
    }
    setPreps(nextPreps);
    setDraft((d) => ({ ...d, prep_id: saved.prepId, status: "linked", linked_job_key: projectId }));
    setLinkModal(false);
    setStatus(
      `Paint lines linked to project. Open the job's Paint submittals tab to generate submittals or use PDF / Google Sheets.`,
    );
  }

  function openEmail() {
    if (!draft.site_location.trim()) {
      setError("Enter a site/location for the vendor email.");
      return;
    }
    const lines = draft.items.filter((i) => i.product.trim() || i.color.trim());
    if (!lines.length) {
      setError("Add at least one paint line with a color before emailing.");
      return;
    }
    setError(null);
    setEmailOpen(true);
  }

  async function openLinkDialog() {
    if (!draft.prep_id) {
      const ok = window.confirm("Save this prep before linking to a job?");
      if (!ok) return;
      const saved = await ensureSavedPrep();
      if (!saved) return;
    }
    setLinkModal(true);
  }

  const emailItems = draft.items.filter((i) => i.product.trim() || i.color.trim());
  const vendorOptions = userSettings?.vendors ?? [];

  return (
    <div className="page stack">
      <div className="page-header">
        <div>
          <h1>Brush-out request</h1>
          <p className="muted">
            Start brush-outs before the office assigns an official job number and name. Use site/location in the
            vendor email — not a job name. When the job is created, reply to that email with the job # and name,
            then link the prep into the project&apos;s Paint submittals.
          </p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card stack">
        <h2>Reference (for this request)</h2>
        <div className="grid-2">
          <label>
            Internal reference
            <input
              value={draft.internal_reference}
              onChange={(e) => setDraft((d) => ({ ...d, internal_reference: e.target.value }))}
              placeholder="Ironwood Commercial Builders"
            />
          </label>
          <label>
            GC (optional)
            <input value={draft.gc} onChange={(e) => setDraft((d) => ({ ...d, gc: e.target.value }))} />
          </label>
          <label>
            Site / location
            <input
              value={draft.site_location}
              onChange={(e) => setDraft((d) => ({ ...d, site_location: e.target.value }))}
              placeholder="Citi Bank 101 Arroyo Drive"
            />
          </label>
          <label>
            Paint vendor
            <select
              value={draft.paint_vendor}
              onChange={(e) => setDraft((d) => ({ ...d, paint_vendor: e.target.value }))}
            >
              {vendorOptions.map((v) => {
                const label = vendorDisplayName(v);
                return (
                  <option key={v.vendor_email} value={label}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <p className="muted small">Internal reference is for JobFlow only — not included in the vendor email.</p>
        <p className="muted small brushout-prep-status">{statusLine(draft)}</p>
      </section>

      <section className="card row-gap wrap brushout-toolbar">
        <button type="button" className="btn btn-secondary" onClick={newPrep}>
          New prep
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpenModal(true)}>
          Open prep…
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void savePrep()}>
          {saving ? "Saving…" : "Save prep"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void openLinkDialog()}>
          Link to job…
        </button>
        <button type="button" className="btn btn-warning" onClick={openEmail}>
          Email vendor (brush-outs)
        </button>
        {draft.linked_job_key && (
          <Link className="btn btn-secondary" to={`/projects/${draft.linked_job_key}/submittals/paint`}>
            Open linked project
          </Link>
        )}
      </section>

      <PaintImageImport onImported={onImported} layout="row" />

      <section className="card stack paint-items-section">
        <div className="row-between paint-items-toolbar">
          <div>
            <h3>Paint lines</h3>
            <p className="muted small paint-lookup-hint">
              Type a color number or name, then press <kbd>Enter</kbd> or click <strong>Lookup</strong>.
            </p>
          </div>
          <div className="paint-add-buttons">
            <button
              type="button"
              className="btn btn-icon btn-primary"
              title="Add row"
              onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyPaintItem()] }))}
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-icon btn-primary"
              title="Add multiple rows"
              disabled={catalogLoading}
              onClick={() => setBulkOpen(true)}
            >
              ++
            </button>
          </div>
        </div>

        {catalogLoading && <p className="muted small">Loading color catalog…</p>}

        <div className="paint-items-grid" role="table" aria-label="Brush-out paint lines">
          <div className="paint-items-header" role="row">
            <span className="paint-row-handle-spacer" aria-hidden />
            <span className="paint-col-head paint-col-label">Label</span>
            <span className="paint-col-head paint-col-floor">Floor</span>
            <span className="paint-col-head paint-col-color">Color</span>
            <span className="paint-col-head paint-col-product">Product</span>
            <span className="paint-col-head paint-col-sheen">Sheen</span>
            <span className="paint-col-head paint-col-head-actions" aria-hidden />
          </div>
          {draft.items.map((item, index) => (
            <PaintItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              products={products}
              sheenOptions={sheens}
              colors={colors}
              showPreviousColor={false}
              showFloor
              autoLabel={false}
              dragging={dragFrom === index}
              dragOver={dragOver === index}
              onChange={(patch) => patchItem(index, patch)}
              onDragStart={() => setDragFrom(index)}
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== index) {
                  setDraft((d) => ({ ...d, items: moveItem(d.items, dragFrom, index) }));
                }
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onRemove={() =>
                setDraft((d) => ({
                  ...d,
                  items: d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items,
                }))
              }
            />
          ))}
        </div>
      </section>

      {bulkOpen && (
        <PaintBulkAddModal
          products={products}
          sheenOptions={sheens}
          autoLabel={false}
          nextAutoLabelIndex={draft.items.filter(paintItemHasContent).length}
          onAdd={(items) =>
            setDraft((d) => ({
              ...d,
              items: [...d.items.filter(paintItemHasContent), ...items],
            }))
          }
          onClose={() => setBulkOpen(false)}
        />
      )}

      {openModal && (
        <OpenBrushoutPrepModal
          preps={sortedPreps}
          onOpen={loadPrep}
          onClose={() => setOpenModal(false)}
        />
      )}

      {linkModal && draft.prep_id && (
        <LinkBrushoutPrepModal
          prep={
            preps.find((p) => p.prep_id === draft.prep_id) ??
            buildPrepRecord(draft, currentRecord, preps).record
          }
          onLink={(projectId, mergeMode) => void onLink(projectId, mergeMode)}
          onClose={() => setLinkModal(false)}
        />
      )}

      {emailOpen && userSettings && (
        <EmailVendorModal
          jobNumber=""
          jobName=""
          items={emailItems}
          submittalType="original"
          vendors={userSettings.vendors}
          defaultQty={userSettings.default_brushout_qty}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          mode="prep"
          prepSite={draft.site_location}
          prepGc={draft.gc}
          composeEmailMethod={userSettings.compose_email_method}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  );
}
