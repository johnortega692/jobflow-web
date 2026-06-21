import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { TrackItemRow } from "../components/track/TrackItemRow";
import { DeliveryAddressModal } from "../components/wallcovering/DeliveryAddressModal";
import { VendorOrderModal } from "../components/wallcovering/VendorOrderModal";
import { WcOrderSamplesModal } from "../components/wallcovering/WcOrderSamplesModal";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { loadContactDirectory } from "../lib/contactDirectory";
import {
  DEFAULT_DELIVERY_SCHEDULING,
  loadDeliverySettings,
  type DeliverySchedulingSettings,
} from "../lib/deliverySettings";
import type { FrpCatalog } from "../lib/frpCatalog";
import { loadFrpCatalog } from "../lib/frpCatalog";
import { frpItemsToOrderForm, printFrpOrderForm } from "../lib/frpOrderFormPrint";
import {
  frpJobName,
  frpJobNumber,
  jobFullAddressOneLine,
  trackJobName,
  trackJobNumber,
  wcTrackerJobName,
  wcTrackerJobNumber,
} from "../lib/jobInfo";
import { orderedWallcoveringItems } from "../lib/wcSampleOrderEmail";
import {
  printWallcoveringOrderForm,
  wallcoveringItemsToOrderForm,
} from "../lib/wallcoveringOrderFormPrint";
import type { TrackCatalog } from "../lib/trackCatalog";
import {
  incrementTrackUsage,
  loadTrackCatalog,
  loadTrackUsage,
  stripProductPrefix,
} from "../lib/trackCatalog";
import { printTrackOrderForm, trackItemsToOrderForm } from "../lib/trackOrderFormPrint";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { MaterialVendor } from "../types/contactDirectory";
import type { ProjectForm } from "../types/database";
import {
  defaultFrpSubmittal,
  defaultTrackSubmittal,
  defaultWallcoveringSubmittal,
  emptyFrpItem,
  emptyTrackItem,
  emptyWallcoveringItem,
  type FrpItem,
  type FrpSubmittalData,
  type TrackItem,
  type TrackSubmittalData,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

type OrderScope = "wallcovering" | "frp";

type UnifiedOrderRow = {
  scope: OrderScope;
  index: number;
  label: string;
  product: string;
  manufacturer: string;
  color: string;
  qty: string;
  order: boolean;
};

type PendingAction =
  | { kind: "wc_form" }
  | { kind: "wc_vendor" }
  | { kind: "wc_samples" }
  | { kind: "frp_form" }
  | { kind: "frp_vendor" }
  | { kind: "fwp_form" }
  | { kind: "fwp_vendor" }
  | { kind: "all_vendor" };

function scopeLabel(scope: OrderScope): string {
  if (scope === "wallcovering") return "Wallcovering";
  return "FRP";
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function wcItemHasContent(item: WallcoveringItem): boolean {
  return Boolean(item.manufacturer.trim() || item.product.trim() || item.label.trim());
}

function frpItemHasContent(item: FrpItem): boolean {
  return Boolean(item.manufacturer.trim() || item.product.trim() || item.label.trim());
}

function trackItemHasContent(item: TrackItem): boolean {
  return Boolean(item.product.trim() || item.mat_code.trim());
}

function normalizeWcDraft(raw: WallcoveringSubmittalData): WallcoveringSubmittalData {
  const items = (raw.items ?? [emptyWallcoveringItem()]).map((i) => ({
    ...emptyWallcoveringItem(),
    ...i,
    order: i.order ?? false,
  }));
  return { ...defaultWallcoveringSubmittal(), ...raw, items };
}

function normalizeFrpDraft(raw: FrpSubmittalData): FrpSubmittalData {
  const items = (raw.items ?? [emptyFrpItem()]).map((i) => ({
    ...emptyFrpItem(),
    ...i,
    order: i.order ?? false,
  }));
  return { ...defaultFrpSubmittal(), ...raw, items };
}

function normalizeTrackDraft(raw: TrackSubmittalData): TrackSubmittalData {
  const items = (raw.items ?? [emptyTrackItem()]).map((i) => ({
    ...emptyTrackItem(),
    ...i,
    order: i.order ?? false,
  }));
  return { ...defaultTrackSubmittal(), ...raw, items };
}

function buildUnifiedRows(wc: WallcoveringSubmittalData, frp: FrpSubmittalData): UnifiedOrderRow[] {
  const rows: UnifiedOrderRow[] = [];
  wc.items.forEach((item, index) => {
    if (!wcItemHasContent(item)) return;
    rows.push({
      scope: "wallcovering",
      index,
      label: item.label,
      product: item.product,
      manufacturer: item.manufacturer,
      color: item.color,
      qty: item.qty,
      order: item.order,
    });
  });
  frp.items.forEach((item, index) => {
    if (!frpItemHasContent(item)) return;
    rows.push({
      scope: "frp",
      index,
      label: item.label,
      product: item.product,
      manufacturer: item.manufacturer,
      color: item.color,
      qty: item.quantity,
      order: item.order,
    });
  });
  return rows;
}

export function ProjectOrdersPage() {
  const { user } = useAuth();
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);

  const [wcDraft, setWcDraft] = useState<WallcoveringSubmittalData>(defaultWallcoveringSubmittal());
  const [frpDraft, setFrpDraft] = useState<FrpSubmittalData>(defaultFrpSubmittal());
  const [trackDraft, setTrackDraft] = useState<TrackSubmittalData>(defaultTrackSubmittal());
  const [frpCatalog, setFrpCatalog] = useState<FrpCatalog | null>(null);
  const [trackCatalog, setTrackCatalog] = useState<TrackCatalog | null>(null);
  const [trackUsage, setTrackUsage] = useState<Record<string, number>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [vendors, setVendors] = useState<MaterialVendor[]>([]);
  const [deliverySettings, setDeliverySettings] = useState<DeliverySchedulingSettings>(
    DEFAULT_DELIVERY_SCHEDULING,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingDeliveryAddress, setPendingDeliveryAddress] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorMode, setVendorMode] = useState<"samples" | "orders_by_vendor">("orders_by_vendor");
  const [pendingVendor, setPendingVendor] = useState<{ name: string; email: string } | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      setWcDraft(normalizeWcDraft(tradeData.wallcovering_submittal ?? defaultWallcoveringSubmittal()));
      setFrpDraft(normalizeFrpDraft(tradeData.frp_submittal ?? defaultFrpSubmittal()));
      setTrackDraft(normalizeTrackDraft(tradeData.track_submittal ?? defaultTrackSubmittal()));
    }
  }, [loading, tradeData.frp_submittal, tradeData.track_submittal, tradeData.wallcovering_submittal]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadFrpCatalog(), loadTrackCatalog(), loadTrackUsage()])
      .then(([frp, track, usage]) => {
        if (!cancelled) {
          setFrpCatalog(frp);
          setTrackCatalog(track);
          setTrackUsage(usage);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load catalogs");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  useEffect(() => {
    if (!user?.id) return;
    void loadContactDirectory(user.id).then((d) => setVendors(d.material_vendors));
    void loadDeliverySettings(user.id).then(setDeliverySettings);
  }, [user?.id]);

  const wcJobNumber = wcTrackerJobNumber(project);
  const wcJobName = wcTrackerJobName(project);
  const frpNum = frpJobNumber(project);
  const frpName = frpJobName(project);
  const fwpNum = trackJobNumber(project);
  const fwpName = trackJobName(project);

  const unifiedRows = useMemo(() => buildUnifiedRows(wcDraft, frpDraft), [wcDraft, frpDraft]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unifiedRows;
    return unifiedRows.filter((row) =>
      [scopeLabel(row.scope), row.label, row.product, row.manufacturer, row.color, row.qty]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [search, unifiedRows]);

  const wcFrpCheckedCount = unifiedRows.filter((r) => r.order).length;
  const fwpCheckedCount = trackDraft.items.filter((i) => i.order && trackItemHasContent(i)).length;
  const checkedCount = wcFrpCheckedCount + fwpCheckedCount;
  const wcOrdered = orderedWallcoveringItems(wcDraft.items);

  async function persistAll() {
    const ok = await save({
      ...tradeData,
      wallcovering_submittal: wcDraft,
      frp_submittal: frpDraft,
      track_submittal: trackDraft,
    });
    if (ok) {
      setError(null);
      setStatus("Order selections and quantities saved.");
    }
    return ok;
  }

  function setOrder(scope: OrderScope, index: number, order: boolean) {
    if (scope === "wallcovering") {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, order } : item)),
      }));
    } else {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, order } : item)),
      }));
    }
  }

  function setQty(scope: OrderScope, index: number, qty: string) {
    if (scope === "wallcovering") {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, qty } : item)),
      }));
    } else {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, quantity: qty } : item)),
      }));
    }
  }

  function patchFwpItem(index: number, patch: Partial<TrackItem>) {
    setTrackDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function requireJobIds(): boolean {
    if (!wcJobNumber || !wcJobName) {
      setError("Job number and job name are required.");
      return false;
    }
    return true;
  }

  function startDelivery(action: PendingAction) {
    if (!requireJobIds()) return;
    setPendingAction(action);
    setDeliveryOpen(true);
  }

  function startVendor(action: PendingAction) {
    if (!requireJobIds()) return;
    if (action.kind === "wc_samples" && !wcOrdered.length) {
      setError('Check the "Order" box on wallcovering items to include in sample requests.');
      return;
    }
    const needsChecked =
      action.kind === "wc_vendor" ||
      action.kind === "frp_vendor" ||
      action.kind === "fwp_vendor" ||
      action.kind === "all_vendor";
    if (needsChecked && !checkedCount) {
      setError('No items checked for order. Check the "Order" box on lines to include.');
      return;
    }
    if (action.kind === "wc_samples") {
      setPendingAction(action);
      setVendorMode("samples");
      setVendorOpen(true);
      return;
    }
    setPendingAction(action);
    setDeliveryOpen(true);
  }

  function printWcForm(items: WallcoveringItem[], address: string, vendor?: string) {
    printWallcoveringOrderForm(
      {
        job_number: wcJobNumber,
        project_name: wcJobName,
        delivery_address: address,
        specifier: project.architect,
        items: wallcoveringItemsToOrderForm(items, vendor),
      },
      branding,
      deliverySettings,
    );
  }

  function printFrpForm(items: FrpItem[], address: string) {
    if (!frpCatalog) throw new Error("FRP catalog unavailable.");
    printFrpOrderForm(
      {
        job_number: frpNum || wcJobNumber,
        project_name: frpName || wcJobName,
        delivery_address: address,
        specifier: project.architect,
        items: frpItemsToOrderForm(items, frpCatalog),
      },
      branding,
      deliverySettings,
    );
  }

  function printFwpForm(items: TrackItem[], address: string) {
    for (const item of items) {
      const product = stripProductPrefix(item.product);
      if (product) incrementTrackUsage(product);
    }
    void loadTrackUsage().then(setTrackUsage);
    printTrackOrderForm(
      {
        job_number: fwpNum || wcJobNumber,
        project_name: fwpName || wcJobName,
        delivery_address: address,
        specifier: project.architect,
        manufacturer: "APS",
        items: trackItemsToOrderForm(items),
      },
      branding,
      deliverySettings,
    );
  }

  function onDeliveryConfirmed(address: string) {
    setDeliveryOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;

    if (
      action.kind === "wc_vendor" ||
      action.kind === "frp_vendor" ||
      action.kind === "fwp_vendor" ||
      action.kind === "all_vendor"
    ) {
      setPendingDeliveryAddress(address);
      setVendorMode("orders_by_vendor");
      setVendorOpen(true);
      return;
    }

    try {
      if (action.kind === "wc_form") {
        const items = wcDraft.items.filter(wcItemHasContent);
        if (!items.length) throw new Error("Add wallcovering items in the Wallcovering tab first.");
        printWcForm(items, address);
        setStatus("Wallcovering order form PDF opened.");
      } else if (action.kind === "frp_form") {
        const items = frpDraft.items.filter(frpItemHasContent);
        if (!items.length) throw new Error("Add FRP items in the FRP tab first.");
        printFrpForm(items, address);
        setStatus("FRP order form PDF opened.");
      } else if (action.kind === "fwp_form") {
        const items = trackDraft.items.filter(trackItemHasContent);
        if (!items.length) throw new Error("Add FWP items below before generating an order form.");
        printFwpForm(items, address);
        setStatus("FWP order form PDF opened.");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate order form.");
    }
  }

  function onVendorConfirmed(name: string, email: string) {
    setVendorOpen(false);
    const action = pendingAction;
    setPendingAction(null);

    if (vendorMode === "samples") {
      setPendingVendor({ name, email });
      setSamplesOpen(true);
      return;
    }

    const address = pendingDeliveryAddress;
    try {
      if (action?.kind === "wc_vendor" || action?.kind === "all_vendor") {
        const items = wcDraft.items.filter((i) => i.order);
        if (items.length) printWcForm(items, address, name);
      }
      if (action?.kind === "frp_vendor" || action?.kind === "all_vendor") {
        const items = frpDraft.items.filter((i) => i.order);
        if (items.length) printFrpForm(items, address);
      }
      if (action?.kind === "fwp_vendor" || action?.kind === "all_vendor") {
        const items = trackDraft.items.filter((i) => i.order);
        if (items.length) printFwpForm(items, address);
      }
      setStatus(
        action?.kind === "all_vendor"
          ? `Order form(s) opened for ${name}.`
          : `Order form for ${name} opened.`,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate order form.");
    }
  }

  if (loading || catalogLoading) return <p className="muted">Loading material orders…</p>;
  if (!frpCatalog || !trackCatalog) return <p className="muted">Catalog data unavailable.</p>;

  return (
    <div className="stack project-orders-page">
      <div className="row-between wrap">
        <div>
          <h2>Material orders</h2>
          <p className="muted small">
            Wallcovering and FRP — check items, enter quantities, and order from different vendors.
            FWP stretch-fabric orders are managed in the section below.
          </p>
        </div>
        <div className="row-gap wrap">
          <Link className="btn btn-ghost" to={`/projects/${projectId}/wallcovering`}>
            Wallcovering
          </Link>
          <Link className="btn btn-ghost" to={`/projects/${projectId}/frp`}>
            FRP
          </Link>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void persistAll()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card stack project-orders-actions">
        <p className="muted small">
          {checkedCount} item{checkedCount === 1 ? "" : "s"} checked for order
        </p>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-warning" onClick={() => startVendor({ kind: "wc_samples" })}>
            WC — Order samples
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startDelivery({ kind: "wc_form" })}>
            WC — Order form PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startVendor({ kind: "wc_vendor" })}>
            WC — By vendor
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startDelivery({ kind: "frp_form" })}>
            FRP — Order form PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startVendor({ kind: "frp_vendor" })}>
            FRP — By vendor
          </button>
          <button type="button" className="btn btn-primary" onClick={() => startVendor({ kind: "all_vendor" })}>
            All checked — by vendor
          </button>
        </div>
      </section>

      <div className="projects-search-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scope, label, product, color…"
          aria-label="Search order lines"
        />
        {search.trim() && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch("")}>
            Clear
          </button>
        )}
      </div>

      {unifiedRows.length === 0 ? (
        <div className="card empty-state">
          <p>No wallcovering or FRP lines yet. Add items on those scope tabs, or use FWP below.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="card empty-state">
          <p>No lines match your search.</p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data-table project-orders-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Scope</th>
                <th>Label</th>
                <th>Product</th>
                <th>Manufacturer</th>
                <th>Color / code</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={`${row.scope}-${row.index}`}>
                  <td>
                    <label className="check project-orders-check">
                      <input
                        type="checkbox"
                        checked={row.order}
                        onChange={(e) => setOrder(row.scope, row.index, e.target.checked)}
                      />
                    </label>
                  </td>
                  <td>
                    <span className={`pill project-orders-scope project-orders-scope--${row.scope}`}>
                      {scopeLabel(row.scope)}
                    </span>
                  </td>
                  <td>{row.label || "—"}</td>
                  <td>{row.product || "—"}</td>
                  <td>{row.manufacturer || "—"}</td>
                  <td>{row.color || "—"}</td>
                  <td>
                    <input
                      className="project-orders-qty"
                      value={row.qty}
                      placeholder="Qty"
                      onChange={(e) => setQty(row.scope, row.index, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card stack project-orders-fwp">
        <div className="row-between wrap">
          <div>
            <h3>FWP (stretch fabric)</h3>
            <p className="muted small">
              Order-only — add track and infill lines, then generate the APS order form PDF. Not used
              for submittals.
            </p>
          </div>
          <div className="row-gap wrap">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setTrackDraft((d) => ({
                  ...d,
                  items: [...d.items.filter(trackItemHasContent), emptyTrackItem()],
                }))
              }
            >
              Add item
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => startDelivery({ kind: "fwp_form" })}
            >
              Order form PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => startVendor({ kind: "fwp_vendor" })}
            >
              Checked lines — by vendor
            </button>
          </div>
        </div>

        <div className="track-items-list">
          {trackDraft.items.map((item, index) => (
            <TrackItemRow
              key={`fwp-${index}`}
              item={item}
              index={index}
              total={trackDraft.items.length}
              catalog={trackCatalog}
              usage={trackUsage}
              onChange={(patch) => patchFwpItem(index, patch)}
              onMoveUp={() =>
                setTrackDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                setTrackDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                setTrackDraft((d) => {
                  const next = d.items.filter((_, i) => i !== index);
                  return { ...d, items: next.length ? next : [emptyTrackItem()] };
                })
              }
            />
          ))}
        </div>
      </section>

      {deliveryOpen && (
        <DeliveryAddressModal
          defaultAddress={jobFullAddressOneLine(project, project.jobInfo)}
          warehouseAddress={deliverySettings.default_delivery_address}
          onConfirm={onDeliveryConfirmed}
          onClose={() => {
            setDeliveryOpen(false);
            setPendingAction(null);
          }}
        />
      )}

      {vendorOpen && (
        <VendorOrderModal
          title={
            vendorMode === "samples"
              ? "Order Samples — Vendor"
              : pendingAction?.kind === "all_vendor"
                ? "All checked — Vendor"
                : "Material Orders by Vendor"
          }
          vendors={vendors}
          onConfirm={onVendorConfirmed}
          onClose={() => {
            setVendorOpen(false);
            setPendingAction(null);
          }}
        />
      )}

      {samplesOpen && pendingVendor && (
        <WcOrderSamplesModal
          vendor={pendingVendor.name}
          vendorEmail={pendingVendor.email}
          jobNumber={wcJobNumber}
          jobName={wcJobName}
          architect={project.architect}
          items={wcOrdered}
          onClose={() => {
            setSamplesOpen(false);
            setPendingVendor(null);
          }}
        />
      )}
    </div>
  );
}
