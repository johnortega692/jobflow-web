import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CreateRevisedSubmittalModal } from "../components/submittals/CreateRevisedSubmittalModal";
import { DateInput } from "../components/DateInput";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { DeliveryAddressModal } from "../components/wallcovering/DeliveryAddressModal";
import { VendorOrderModal } from "../components/wallcovering/VendorOrderModal";
import { WallcoveringBulkAddModal } from "../components/wallcovering/WallcoveringBulkAddModal";
import { WallcoveringItemRow } from "../components/wallcovering/WallcoveringItemRow";
import { WcOrderSamplesModal } from "../components/wallcovering/WcOrderSamplesModal";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { loadContactDirectory } from "../lib/contactDirectory";
import {
  DEFAULT_DELIVERY_SCHEDULING,
  loadDeliverySettings,
  type DeliverySchedulingSettings,
} from "../lib/deliverySettings";
import { loadPaintUserSettings } from "../lib/paintUserSettings";
import {
  addSubmittalToHistory,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { copyWallcoveringToTracker } from "../lib/wcSheetsSync";
import { applyGotTrackToggle, detectGotTrack } from "../lib/wcTrackInfill";
import { orderedWallcoveringItems } from "../lib/wcSampleOrderEmail";
import {
  printWallcoveringOrderForm,
  wallcoveringItemsToOrderForm,
} from "../lib/wallcoveringOrderFormPrint";
import { printWallcoveringSubmittal } from "../lib/wallcoveringSubmittalPrint";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { MaterialVendor } from "../types/contactDirectory";
import type { ProjectForm } from "../types/database";
import {
  defaultTransmittal,
  defaultWallcoveringSubmittal,
  emptyWallcoveringItem,
  WALLCOVERING_SUBMITTAL_TYPES,
  wcSubjectForType,
  type SubmittalHistoryEntry,
  type TradeSubmittalType,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function normalizeWcDraft(raw: WallcoveringSubmittalData): WallcoveringSubmittalData {
  const items = (raw.items ?? [emptyWallcoveringItem()]).map((i) => ({
    ...emptyWallcoveringItem(),
    ...i,
    order: i.order ?? false,
  }));
  return {
    ...defaultWallcoveringSubmittal(),
    ...raw,
    items,
    got_track: raw.got_track ?? detectGotTrack(items),
  };
}

export function WallcoveringSubmittalsPage() {
  const { user } = useAuth();
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<WallcoveringSubmittalData>(defaultWallcoveringSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisedOpen, setRevisedOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<"order_form" | "orders_by_vendor">("order_form");
  const [pendingDeliveryAddress, setPendingDeliveryAddress] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorMode, setVendorMode] = useState<"samples" | "orders_by_vendor">("samples");
  const [pendingVendor, setPendingVendor] = useState<{ name: string; email: string } | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [vendors, setVendors] = useState<MaterialVendor[]>([]);
  const [deliverySettings, setDeliverySettings] = useState<DeliverySchedulingSettings>(
    DEFAULT_DELIVERY_SCHEDULING,
  );

  useEffect(() => {
    if (!loading) {
      setDraft(
        normalizeWcDraft(tradeData.wallcovering_submittal ?? defaultWallcoveringSubmittal()),
      );
      setHistory(tradeData.wallcovering_submittal_history ?? []);
    }
  }, [loading, tradeData.wallcovering_submittal, tradeData.wallcovering_submittal_history]);

  useEffect(() => {
    if (!user?.id) return;
    void loadContactDirectory(user.id).then((d) => setVendors(d.material_vendors));
    void loadDeliverySettings(user.id).then(setDeliverySettings);
  }, [user?.id]);

  const showPreviousColor = draft.submittal_type === "substitution";
  const orderedItems = orderedWallcoveringItems(draft.items);

  async function persist(nextDraft: WallcoveringSubmittalData, nextHistory = history) {
    const ok = await save({
      ...tradeData,
      wallcovering_submittal: nextDraft,
      wallcovering_submittal_history: nextHistory,
    });
    if (ok) {
      setDraft(nextDraft);
      setHistory(nextHistory);
      setError(null);
    }
    return ok;
  }

  function setType(t: TradeSubmittalType) {
    setDraft((d) => ({ ...d, submittal_type: t, subject: wcSubjectForType(t) }));
  }

  function patchItem(index: number, patch: Partial<WallcoveringItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onGotTrackChange(checked: boolean) {
    setDraft((d) => ({
      ...d,
      got_track: checked,
      items: applyGotTrackToggle(d.items, checked),
    }));
  }

  function loadHistoryItems(items: WallcoveringItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({ ...emptyWallcoveringItem(), ...i, order: i.order ?? false }))
      : [emptyWallcoveringItem()];
    setDraft((d) => ({
      ...d,
      items: replace
        ? mapped
        : [
            ...d.items.filter((i) => i.label || i.color || i.manufacturer || i.product),
            ...mapped,
          ],
      got_track: detectGotTrack(replace ? mapped : [...d.items, ...mapped]),
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
  }

  async function onPrint() {
    try {
      printWallcoveringSubmittal(
        {
          job_number: project.job_number,
          job_name: project.job_name,
          job_address: project.job_address ?? "",
        },
        draft,
        branding,
      );
      const nextHistory = addSubmittalToHistory(
        history,
        draft.submittal_number,
        draft.items,
        draft.submittal_type,
        "wallcovering",
      );
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: "Color Samples",
          scope: "Wallcovering",
          spec: "096000",
          notes: `Wallcovering submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* log row optional */
      }
      const transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: "Color Samples",
        scope: "Wallcovering",
        source: "wallcovering_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
      await save({
        ...tradeData,
        wallcovering_submittal: draft,
        wallcovering_submittal_history: nextHistory,
        transmittal,
      });
      setStatus(`Submittal #${draft.submittal_number} saved to history.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
  }

  function startOrderForm(mode: "order_form" | "orders_by_vendor") {
    const items =
      mode === "orders_by_vendor"
        ? draft.items.filter((i) => i.order)
        : draft.items.filter((i) => i.manufacturer.trim() || i.product.trim() || i.label.trim());
    if (!items.length) {
      setError(
        mode === "orders_by_vendor"
          ? 'No items checked for order. Check the "Order" box on items to include.'
          : "Add wallcovering items before generating an order form.",
      );
      return;
    }
    if (!project.job_number.trim() || !project.job_name.trim()) {
      setError("Job number and job name are required.");
      return;
    }
    setDeliveryMode(mode);
    setDeliveryOpen(true);
  }

  function onDeliveryConfirmed(address: string) {
    setDeliveryOpen(false);
    if (deliveryMode === "orders_by_vendor") {
      setPendingDeliveryAddress(address);
      setVendorMode("orders_by_vendor");
      setVendorOpen(true);
      return;
    }
    try {
      printWallcoveringOrderForm(
        {
          job_number: project.job_number,
          project_name: project.job_name,
          delivery_address: address,
          specifier: project.architect,
          items: wallcoveringItemsToOrderForm(draft.items),
        },
        branding,
        deliverySettings,
      );
      setStatus("Order form PDF opened.");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate order form.");
    }
  }

  function onVendorConfirmed(name: string, email: string) {
    setVendorOpen(false);
    if (vendorMode === "samples") {
      setPendingVendor({ name, email });
      setSamplesOpen(true);
      return;
    }
    try {
      printWallcoveringOrderForm(
        {
          job_number: project.job_number,
          project_name: project.job_name,
          delivery_address: pendingDeliveryAddress,
          specifier: project.architect,
          items: wallcoveringItemsToOrderForm(
            draft.items.filter((i) => i.order),
            name,
          ),
        },
        branding,
        deliverySettings,
      );
      setStatus(`Order form for ${name} opened.`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate order form.");
    }
  }

  function startOrderSamples() {
    if (!orderedItems.length) {
      setError(
        'No items checked for order. Check the "Order" box on each item you want to sample.',
      );
      return;
    }
    if (!project.job_number.trim() || !project.job_name.trim()) {
      setError("Job number and job name are required.");
      return;
    }
    setVendorMode("samples");
    setVendorOpen(true);
  }

  async function onCopyToTracker() {
    setTrackerBusy(true);
    try {
      const settings = user?.id ? await loadPaintUserSettings(user.id) : null;
      const err = await copyWallcoveringToTracker(
        settings?.google_urls.wallcovering_tracker,
        project.job_number,
        project.job_name,
        project.contractor,
        project.jobInfo.start_date,
        draft.items,
      );
      if (err) setError(err);
      else {
        setStatus("Data sent to Wallcovering Tracker.");
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tracker sync failed");
    } finally {
      setTrackerBusy(false);
    }
  }

  async function onDeleteHistory(submittalNumber: number) {
    const nextHistory = removeSubmittalFromHistory(history, submittalNumber);
    setHistory(nextHistory);
    await persist(draft, nextHistory);
    setStatus(`Removed submittal #${submittalNumber} from history.`);
  }

  if (loading) return <p className="muted">Loading wallcovering submittal…</p>;

  return (
    <div className="stack">
      <h2 className="wc-section-title">Wallcovering Submittals Section</h2>

      <section className="card wc-action-bar">
        <div className="wc-main-buttons row-gap wrap">
          <button type="button" className="btn btn-primary" onClick={() => void onPrint()}>
            Submittal PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            Submittal history…
          </button>
          <button type="button" className="btn btn-warning" onClick={startOrderSamples}>
            Order Samples
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={trackerBusy}
            onClick={() => void onCopyToTracker()}
          >
            {trackerBusy ? "Sending…" : "Copy to WC Tracker"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startOrderForm("order_form")}>
            Order Form PDF
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => startOrderForm("orders_by_vendor")}
          >
            Orders by Vendor
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setRevisedOpen(true)}>
            Create revised submittal
          </button>
          <button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card stack">
        <div className="grid-3">
          <label>
            Submittal #
            <input
              type="number"
              min={1}
              value={draft.submittal_number}
              onChange={(e) => setDraft({ ...draft, submittal_number: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Type
            <select
              value={draft.submittal_type}
              onChange={(e) => setType(e.target.value as TradeSubmittalType)}
            >
              {WALLCOVERING_SUBMITTAL_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <DateInput value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
          </label>
        </div>
        <label>
          Subject
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
      </section>

      <section className="card stack wc-items-section">
        <div className="row-between wc-items-toolbar">
          <h3 className="muted small">Wallcovering items</h3>
          <div className="row-gap wrap">
            <label className="check wc-got-track">
              <input
                type="checkbox"
                checked={Boolean(draft.got_track)}
                onChange={(e) => onGotTrackChange(e.target.checked)}
              />
              Got Track?
            </label>
            <div className="paint-add-buttons">
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add row"
                onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyWallcoveringItem()] }))}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add multiple rows"
                onClick={() => setBulkOpen(true)}
              >
                ++
              </button>
            </div>
          </div>
        </div>

        <div className="wc-items-list">
          {draft.items.map((item, index) => (
            <WallcoveringItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              showPreviousColor={showPreviousColor}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                setDraft((d) => {
                  const nextItems =
                    d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items;
                  return {
                    ...d,
                    items: nextItems,
                    got_track: detectGotTrack(nextItems),
                  };
                })
              }
            />
          ))}
        </div>
      </section>

      {bulkOpen && (
        <WallcoveringBulkAddModal
          onAdd={(items) =>
            setDraft((d) => ({
              ...d,
              items: [
                ...d.items.filter((i) => i.label || i.color || i.manufacturer || i.product),
                ...items,
              ],
              got_track: detectGotTrack([...d.items, ...items]),
            }))
          }
          onClose={() => setBulkOpen(false)}
        />
      )}

      {deliveryOpen && (
        <DeliveryAddressModal
          defaultAddress={project.job_address ?? ""}
          warehouseAddress={deliverySettings.default_delivery_address}
          onConfirm={onDeliveryConfirmed}
          onClose={() => setDeliveryOpen(false)}
        />
      )}

      {vendorOpen && (
        <VendorOrderModal
          title={vendorMode === "samples" ? "Order Samples — Vendor" : "Wallcovering Orders by Vendor"}
          vendors={vendors}
          onConfirm={onVendorConfirmed}
          onClose={() => setVendorOpen(false)}
        />
      )}

      {samplesOpen && pendingVendor && (
        <WcOrderSamplesModal
          vendor={pendingVendor.name}
          vendorEmail={pendingVendor.email}
          jobNumber={project.job_number}
          jobName={project.job_name}
          architect={project.architect}
          items={orderedItems}
          onClose={() => {
            setSamplesOpen(false);
            setPendingVendor(null);
          }}
        />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="wallcovering"
          jobNumber={project.job_number}
          jobName={project.job_name}
          history={history}
          onLoadWallcovering={loadHistoryItems}
          onDelete={(n) => void onDeleteHistory(n)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {revisedOpen && (
        <CreateRevisedSubmittalModal
          scope="wallcovering"
          projectId={projectId}
          project={{
            job_number: project.job_number,
            job_name: project.job_name,
            job_address: project.job_address ?? "",
          }}
          history={history}
          branding={branding}
          onClose={() => setRevisedOpen(false)}
          onCreated={({ draft: revisedDraft, history: nextHistory }) => {
            void persist(normalizeWcDraft(revisedDraft as WallcoveringSubmittalData), nextHistory);
            setRevisedOpen(false);
            setStatus(`Revised submittal #${revisedDraft.submittal_number} saved.`);
          }}
        />
      )}
    </div>
  );
}
