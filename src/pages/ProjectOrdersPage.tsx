import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MaterialOrderEmailModal } from "../components/orders/MaterialOrderEmailModal";
import { TrackItemRow } from "../components/track/TrackItemRow";
import { DeliveryAddressModal } from "../components/wallcovering/DeliveryAddressModal";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  previewNextMaterialOrderPo,
  recordMaterialOrderPo,
  resolveMaterialOrderPo,
  type MaterialOrderPoScope,
} from "../lib/materialOrderPo";
import { loadContactDirectory } from "../lib/contactDirectory";
import {
  DEFAULT_DELIVERY_SCHEDULING,
  loadDeliverySettings,
  type DeliverySchedulingSettings,
} from "../lib/deliverySettings";
import type { FrpCatalog } from "../lib/frpCatalog";
import { loadFrpCatalog } from "../lib/frpCatalog";
import { frpItemsToOrderForm, downloadFrpOrderForm } from "../lib/frpOrderFormPrint";
import {
  jobFullAddressOneLine,
  trackJobName,
  trackJobNumber,
  wcTrackerJobName,
  wcTrackerJobNumber,
} from "../lib/jobInfo";
import {
  resolveMaterialOrderEmailType,
  type MaterialOrderEmailItem,
} from "../lib/materialOrderEmail";
import {
  downloadWallcoveringOrderForm,
  wallcoveringItemsToOrderForm,
} from "../lib/wallcoveringOrderFormPrint";
import type { TrackCatalog } from "../lib/trackCatalog";
import {
  incrementTrackUsage,
  loadTrackCatalog,
  loadTrackUsage,
  stripProductPrefix,
} from "../lib/trackCatalog";
import { downloadTrackOrderForm, trackItemsToOrderForm } from "../lib/trackOrderFormPrint";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { MaterialVendor } from "../types/contactDirectory";
import type { ProjectForm } from "../types/database";
import {
  MATERIAL_ORDER_UNITS,
  defaultFrpSubmittal,
  defaultTrackSubmittal,
  defaultWallcoveringSubmittal,
  emptyFrpItem,
  emptyTrackItem,
  emptyWallcoveringItem,
  type FrpItem,
  type FrpSubmittalData,
  type MaterialOrderUnit,
  type TrackItem,
  type TrackSubmittalData,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

type OrderScope = "wallcovering" | "frp";
type ScopeFilter = "all" | OrderScope;

type UnifiedOrderRow = {
  scope: OrderScope;
  index: number;
  label: string;
  product: string;
  manufacturer: string;
  color: string;
  qty: string;
  unit: string;
  notes: string;
  order: boolean;
};

type PendingAction =
  | { kind: "wc_form" }
  | { kind: "frp_form" }
  | { kind: "fwp_form" }
  | { kind: "fwp_email_order" }
  | { kind: "email_order" };

type EmailOrderMode = "material" | "fwp";

function scopeLabel(scope: OrderScope): string {
  if (scope === "wallcovering") return "WC";
  return "FRP";
}

function qtyNumericOnly(raw: string): string {
  return raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function uniqueVendors(rows: UnifiedOrderRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const m = row.manufacturer.trim();
    if (m) set.add(m);
  }
  return [...set];
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
    unit: i.unit?.trim() || "EA",
  }));
  return { ...defaultWallcoveringSubmittal(), ...raw, items };
}

function normalizeFrpDraft(raw: FrpSubmittalData): FrpSubmittalData {
  const items = (raw.items ?? [emptyFrpItem()]).map((i) => ({
    ...emptyFrpItem(),
    ...i,
    order: i.order ?? false,
    unit: i.unit?.trim() || "EA",
  }));
  return { ...defaultFrpSubmittal(), ...raw, items };
}

function normalizeTrackDraft(raw: TrackSubmittalData): TrackSubmittalData {
  const items = (raw.items ?? [emptyTrackItem()]).map((i) => ({
    ...emptyTrackItem(),
    ...i,
    order: i.order ?? false,
    unit: (i.unit?.trim() || "LF") as TrackItem["unit"],
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
      unit: item.unit?.trim() || "EA",
      notes: item.notes,
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
      unit: item.unit?.trim() || "EA",
      notes: item.notes,
      order: item.order,
    });
  });
  return rows;
}

export function ProjectOrdersPage() {
  const { user } = useAuth();
  const { branding, profile, settings } = useLetterhead();
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
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingDeliveryAddress, setPendingDeliveryAddress] = useState("");
  const [pendingPoOverride, setPendingPoOverride] = useState<string | null>(null);
  /** Sync copy — state alone is stale when PDF runs in the same tick as setPendingPoOverride. */
  const pendingPoRef = useRef<string | null>(null);
  const [emailOrderOpen, setEmailOrderOpen] = useState(false);
  const [emailOrderPo, setEmailOrderPo] = useState("");
  const [emailOrderMode, setEmailOrderMode] = useState<EmailOrderMode>("material");

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
  const fwpNum = trackJobNumber(project);
  const fwpName = trackJobName(project);
  /** WC/FRP material orders — PO sequence keyed by wallcovering job #. */
  const materialPoJobCode = wcJobNumber;
  /** FWP orders — PO sequence keyed by track/FWP job #. */
  const fwpPoJobCode = fwpNum || wcJobNumber;
  const activePoJobCode =
    pendingAction?.kind === "fwp_form" || pendingAction?.kind === "fwp_email_order"
      ? fwpPoJobCode
      : materialPoJobCode;

  const unifiedRows = useMemo(() => buildUnifiedRows(wcDraft, frpDraft), [wcDraft, frpDraft]);

  const visibleRows = useMemo(() => {
    if (scopeFilter === "all") return unifiedRows;
    return unifiedRows.filter((r) => r.scope === scopeFilter);
  }, [unifiedRows, scopeFilter]);

  const checkedRows = useMemo(() => unifiedRows.filter((r) => r.order), [unifiedRows]);
  const checkedWc = useMemo(() => checkedRows.filter((r) => r.scope === "wallcovering"), [checkedRows]);
  const checkedFrp = useMemo(() => checkedRows.filter((r) => r.scope === "frp"), [checkedRows]);
  const missingQtyChecked = useMemo(
    () => checkedRows.filter((r) => !r.qty.trim()).length,
    [checkedRows],
  );
  const wcVendorCount = useMemo(() => uniqueVendors(checkedWc).length, [checkedWc]);
  const frpVendorCount = useMemo(() => uniqueVendors(checkedFrp).length, [checkedFrp]);

  const emailOrderItems = useMemo((): MaterialOrderEmailItem[] => {
    const rows: MaterialOrderEmailItem[] = [];
    for (const item of wcDraft.items) {
      if (!item.order || !wcItemHasContent(item)) continue;
      rows.push({
        manufacturer: item.manufacturer,
        product: item.product,
        color: item.color,
        quantity: [item.qty.trim(), item.unit?.trim()].filter(Boolean).join(" "),
        label: item.label,
        notes: item.notes,
      });
    }
    for (const item of frpDraft.items) {
      if (!item.order || !frpItemHasContent(item)) continue;
      rows.push({
        manufacturer: item.manufacturer,
        product: item.product,
        color: item.color,
        quantity: [item.quantity.trim(), item.unit?.trim()].filter(Boolean).join(" "),
        label: item.label,
        notes: item.notes,
      });
    }
    return rows;
  }, [wcDraft.items, frpDraft.items]);

  const fwpEmailOrderItems = useMemo((): MaterialOrderEmailItem[] => {
    return trackDraft.items
      .filter((i) => i.order && trackItemHasContent(i))
      .map((item) => ({
        manufacturer: "APS",
        product: stripProductPrefix(item.product),
        color: item.mat_code,
        quantity: [item.quantity.trim(), item.unit?.trim()].filter(Boolean).join(" "),
        label: item.type,
        notes: "",
      }));
  }, [trackDraft.items]);

  const emailMaterialType = resolveMaterialOrderEmailType(
    checkedWc.length > 0,
    checkedFrp.length > 0,
  );

  const visibleAllChecked =
    visibleRows.length > 0 && visibleRows.every((r) => r.order);
  const visibleSomeChecked = visibleRows.some((r) => r.order);

  const fwpCheckedCount = trackDraft.items.filter((i) => i.order && trackItemHasContent(i)).length;

  function confirmMissingQtyIfNeeded(rows: UnifiedOrderRow[]): boolean {
    const missing = rows.filter((r) => r.order && !r.qty.trim());
    if (!missing.length) return true;
    const lines = missing
      .slice(0, 8)
      .map((r) => `${scopeLabel(r.scope)} ${r.label || r.product || "item"}`)
      .join(", ");
    const more = missing.length > 8 ? ` (+${missing.length - 8} more)` : "";
    return window.confirm(
      `${missing.length} checked item${missing.length === 1 ? "" : "s"} missing qty: ${lines}${more}. Continue?`,
    );
  }

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

  function setVisibleOrders(order: boolean) {
    const wcIndexes = new Set(
      visibleRows.filter((r) => r.scope === "wallcovering").map((r) => r.index),
    );
    const frpIndexes = new Set(visibleRows.filter((r) => r.scope === "frp").map((r) => r.index));
    if (wcIndexes.size) {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (wcIndexes.has(i) ? { ...item, order } : item)),
      }));
    }
    if (frpIndexes.size) {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (frpIndexes.has(i) ? { ...item, order } : item)),
      }));
    }
  }

  function setQty(scope: OrderScope, index: number, qty: string) {
    const next = qtyNumericOnly(qty);
    if (scope === "wallcovering") {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, qty: next } : item)),
      }));
    } else {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, quantity: next } : item)),
      }));
    }
  }

  function setUnit(scope: OrderScope, index: number, unit: MaterialOrderUnit) {
    if (scope === "wallcovering") {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, unit } : item)),
      }));
    } else {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, unit } : item)),
      }));
    }
  }

  function setNotes(scope: OrderScope, index: number, notes: string) {
    if (scope === "wallcovering") {
      setWcDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, notes } : item)),
      }));
    } else {
      setFrpDraft((d) => ({
        ...d,
        items: d.items.map((item, i) => (i === index ? { ...item, notes } : item)),
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

  function openDeliveryModal(action: PendingAction) {
    setPendingAction(action);
    setDeliveryOpen(true);
  }

  function startDelivery(action: PendingAction) {
    if (!requireJobIds()) return;
    if (action.kind === "wc_form") {
      if (!checkedWc.length) {
        setError("Check the Order box on wallcovering lines before generating the WC order form PDF.");
        return;
      }
      if (!confirmMissingQtyIfNeeded(checkedWc)) return;
    }
    if (action.kind === "frp_form") {
      if (!checkedFrp.length) {
        setError("Check the Order box on FRP lines before generating the FRP order form PDF.");
        return;
      }
      if (!confirmMissingQtyIfNeeded(checkedFrp)) return;
    }
    if (action.kind === "fwp_form") {
      if (!fwpCheckedCount) {
        setError('Check the Order box on FWP lines to include them on the order form PDF.');
        return;
      }
      const missingQty = trackDraft.items.filter(
        (i) => i.order && trackItemHasContent(i) && !i.quantity.trim(),
      );
      if (missingQty.length) {
        const ok = window.confirm(
          `${missingQty.length} checked FWP line(s) are missing quantity. Continue anyway?`,
        );
        if (!ok) return;
      }
    }
    setError(null);
    openDeliveryModal(action);
  }

  function startVendor(action: PendingAction) {
    if (!requireJobIds()) return;
    if (action.kind === "email_order") {
      if (!checkedRows.length) {
        setError("Check the Order box on wallcovering or FRP lines before emailing the order.");
        return;
      }
      if (!confirmMissingQtyIfNeeded(checkedRows)) return;
    }
    if (action.kind === "fwp_email_order") {
      if (!fwpCheckedCount) {
        setError('Check the Order box on FWP lines before emailing the order.');
        return;
      }
      const missingQty = trackDraft.items.filter(
        (i) => i.order && trackItemHasContent(i) && !i.quantity.trim(),
      );
      if (missingQty.length) {
        const ok = window.confirm(
          `${missingQty.length} checked FWP line(s) are missing quantity. Continue anyway?`,
        );
        if (!ok) return;
      }
    }
    setError(null);
    openDeliveryModal(action);
  }

  function setConfirmedPo(po: string | null) {
    pendingPoRef.current = po;
    setPendingPoOverride(po);
  }

  /** Use only the PO the user entered or pulled — never auto-allocate. */
  async function consumePoNumber(explicitPo?: string, jobCode = activePoJobCode): Promise<string> {
    const override =
      explicitPo?.trim() || pendingPoRef.current?.trim() || pendingPoOverride?.trim() || "";
    if (!override) {
      throw new Error("Get next PO or enter a PO number before generating the order.");
    }
    if (!jobCode) {
      throw new Error("Project job number is required for PO numbering.");
    }
    return resolveMaterialOrderPo({ jobNumber: jobCode, overridePo: override });
  }

  async function issueOrderPdf(input: {
    scope: MaterialOrderPoScope;
    jobNumber: string;
    jobName: string;
    address: string;
    vendorLabel?: string;
    /** Confirmed PO from the delivery modal (preferred over pending state). */
    poNumber?: string;
    /** Job code for PO sequence (defaults to active material/FWP code). */
    poJobCode?: string;
    download: (poNumber: string) => Promise<void>;
  }): Promise<string> {
    const poNumber = await consumePoNumber(input.poNumber, input.poJobCode ?? activePoJobCode);
    await input.download(poNumber);
    await recordMaterialOrderPo({
      projectId,
      jobNumber: input.jobNumber,
      jobName: input.jobName,
      poNumber,
      scope: input.scope,
      vendorLabel: input.vendorLabel,
      deliveryAddress: input.address,
      createdBy: user?.id ?? null,
      createdByName: profile.name.trim() || user?.email || "",
    });
    return poNumber;
  }

  async function downloadWcForm(
    items: WallcoveringItem[],
    address: string,
    vendor?: string,
    poNumber?: string,
  ): Promise<string> {
    return issueOrderPdf({
      scope: "wallcovering",
      jobNumber: wcJobNumber,
      jobName: wcJobName,
      address,
      vendorLabel: vendor,
      poNumber,
      poJobCode: materialPoJobCode,
      download: async (po) => {
        await downloadWallcoveringOrderForm(
          {
            job_number: wcJobNumber,
            project_name: wcJobName,
            delivery_address: address,
            specifier: project.architect,
            po_number: po,
            items: wallcoveringItemsToOrderForm(items, vendor),
          },
          branding,
          deliverySettings,
        );
      },
    });
  }

  async function downloadFrpForm(
    items: FrpItem[],
    address: string,
    vendor?: string,
    poNumber?: string,
  ): Promise<string> {
    if (!frpCatalog) throw new Error("FRP catalog unavailable.");
    return issueOrderPdf({
      scope: "frp",
      jobNumber: wcJobNumber,
      jobName: wcJobName,
      address,
      vendorLabel: vendor,
      poNumber,
      poJobCode: materialPoJobCode,
      download: async (po) => {
        await downloadFrpOrderForm(
          {
            job_number: wcJobNumber,
            project_name: wcJobName,
            delivery_address: address,
            specifier: project.architect,
            po_number: po,
            items: frpItemsToOrderForm(items, frpCatalog),
          },
          branding,
          deliverySettings,
        );
      },
    });
  }

  async function downloadFwpForm(
    items: TrackItem[],
    address: string,
    vendor?: string,
    poNumber?: string,
  ): Promise<string> {
    for (const item of items) {
      const product = stripProductPrefix(item.product);
      if (product) incrementTrackUsage(product);
    }
    void loadTrackUsage().then(setTrackUsage);
    const jobNumber = fwpNum || wcJobNumber;
    const jobName = fwpName || wcJobName;
    return issueOrderPdf({
      scope: "fwp",
      jobNumber,
      jobName,
      address,
      vendorLabel: vendor,
      poNumber,
      poJobCode: fwpPoJobCode,
      download: async (po) => {
        await downloadTrackOrderForm(
          {
            job_number: jobNumber,
            project_name: jobName,
            delivery_address: address,
            specifier: project.architect,
            manufacturer: "APS",
            po_number: po,
            items: trackItemsToOrderForm(items),
          },
          branding,
          deliverySettings,
        );
      },
    });
  }

  function onDeliveryConfirmed(address: string, poNumber: string) {
    setDeliveryOpen(false);
    const action = pendingAction;
    if (!action) return;

    const confirmedPo = poNumber.trim();
    setConfirmedPo(confirmedPo || null);

    if (action.kind === "email_order") {
      setPendingDeliveryAddress(address);
      setEmailOrderPo(confirmedPo);
      setEmailOrderMode("material");
      setEmailOrderOpen(true);
      return;
    }

    if (action.kind === "fwp_email_order") {
      setPendingDeliveryAddress(address);
      setEmailOrderPo(confirmedPo);
      setEmailOrderMode("fwp");
      setEmailOrderOpen(true);
      return;
    }

    setPendingAction(null);

    void (async () => {
      try {
        if (action.kind === "wc_form") {
          const items = wcDraft.items.filter((i) => i.order && wcItemHasContent(i));
          if (!items.length) throw new Error("Check wallcovering items to include on the order form.");
          const po = await downloadWcForm(items, address, undefined, confirmedPo);
          setStatus(`Wallcovering order form PDF downloaded — PO# ${po}.`);
        } else if (action.kind === "frp_form") {
          const items = frpDraft.items.filter((i) => i.order && frpItemHasContent(i));
          if (!items.length) throw new Error("Check FRP items to include on the order form.");
          const po = await downloadFrpForm(items, address, undefined, confirmedPo);
          setStatus(`FRP order form PDF downloaded — PO# ${po}.`);
        } else if (action.kind === "fwp_form") {
          const items = trackDraft.items.filter((i) => i.order && trackItemHasContent(i));
          if (!items.length) throw new Error("Check FWP items to include on the order form.");
          const po = await downloadFwpForm(items, address, undefined, confirmedPo);
          setStatus(`FWP order form PDF downloaded — PO# ${po}.`);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not generate order form.");
      } finally {
        setConfirmedPo(null);
      }
    })();
  }

  async function downloadEmailOrderPdfs(vendor: MaterialVendor) {
    const address = pendingDeliveryAddress;
    const vendorLabel = vendor.products.trim() || vendor.name.trim();
    const po =
      emailOrderPo.trim() || pendingPoRef.current?.trim() || pendingPoOverride?.trim() || undefined;
    const issued: string[] = [];

    if (emailOrderMode === "fwp") {
      const items = trackDraft.items.filter((i) => i.order && trackItemHasContent(i));
      if (!items.length) throw new Error("No checked FWP items to include on the order PDF.");
      issued.push(await downloadFwpForm(items, address, vendorLabel, po));
    } else {
      const wcItems = wcDraft.items.filter((i) => i.order && wcItemHasContent(i));
      const frpItems = frpDraft.items.filter((i) => i.order && frpItemHasContent(i));
      if (wcItems.length) issued.push(await downloadWcForm(wcItems, address, vendorLabel, po));
      if (frpItems.length) issued.push(await downloadFrpForm(frpItems, address, vendorLabel, po));
      if (!issued.length) throw new Error("No checked items to include on the order PDF.");
    }

    setStatus(`Order PDF downloaded for ${vendorLabel} — PO# ${issued.join(", ")}. Attach it to your email.`);
    setError(null);
  }

  if (loading || catalogLoading) return <p className="muted">Loading material orders…</p>;
  if (!frpCatalog || !trackCatalog) return <p className="muted">Catalog data unavailable.</p>;

  const hasChecked = checkedRows.length > 0;
  const showWcActions = checkedWc.length > 0;
  const showFrpActions = checkedFrp.length > 0;

  return (
    <div className="stack project-orders-page">
      <div className="row-between wrap project-orders-page-header">
        <div>
          <h2>Material orders</h2>
          <p className="muted small project-orders-wc-job">
            Wallcovering job: {wcJobNumber || "—"}
            {wcJobName ? ` — ${wcJobName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving}
          onClick={() => void persistAll()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <div
        className="projects-list-filters project-orders-scope-filters"
        role="group"
        aria-label="Filter by scope"
      >
        {(
          [
            ["all", "All"],
            ["wallcovering", "Wallcovering"],
            ["frp", "FRP"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`projects-list-sort-btn projects-list-filter-btn${
              scopeFilter === id ? " projects-list-filter-btn--active" : ""
            }`}
            aria-pressed={scopeFilter === id}
            onClick={() => setScopeFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="card stack project-orders-lines-section">
      {unifiedRows.length === 0 ? (
        <div className="empty-state">
          <p>No wallcovering or FRP lines yet. Add items on those scope tabs, or use FWP below.</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="empty-state">
          <p>No lines match this filter.</p>
        </div>
      ) : (
        <div className="table-wrap project-orders-table-wrap">
          <table className="data-table project-orders-table">
            <colgroup>
              <col className="project-orders-col-order" />
              <col className="project-orders-col-scope" />
              <col className="project-orders-col-label" />
              <col className="project-orders-col-product" />
              <col className="project-orders-col-mfr" />
              <col className="project-orders-col-color" />
              <col className="project-orders-col-qty" />
              <col className="project-orders-col-notes" />
            </colgroup>
            <thead>
              <tr>
                <th className="project-orders-th-order">
                  <label className="check project-orders-check">
                    <input
                      type="checkbox"
                      checked={visibleAllChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = visibleSomeChecked && !visibleAllChecked;
                      }}
                      onChange={(e) => setVisibleOrders(e.target.checked)}
                      aria-label="Check all visible rows"
                    />
                  </label>
                </th>
                <th>Scope</th>
                <th>Label</th>
                <th>Product</th>
                <th>Manufacturer</th>
                <th>Color / code</th>
                <th>Qty</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={`${row.scope}-${row.index}`}
                  className={row.order ? "project-orders-row--checked" : undefined}
                >
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
                  <td className="project-orders-product">{row.product || "—"}</td>
                  <td>{row.manufacturer || "—"}</td>
                  <td>{row.color || "—"}</td>
                  <td>
                    <div className="project-orders-qty-group">
                      <input
                        className="project-orders-qty-input"
                        inputMode="decimal"
                        value={row.qty}
                        placeholder="Qty"
                        onChange={(e) => setQty(row.scope, row.index, e.target.value)}
                        aria-label={`Quantity for ${row.product || row.label || "line"}`}
                      />
                      <select
                        className="project-orders-unit-select"
                        value={row.unit || "EA"}
                        aria-label={`Unit for ${row.product || row.label || "line"}`}
                        onChange={(e) =>
                          setUnit(row.scope, row.index, e.target.value as MaterialOrderUnit)
                        }
                      >
                        {MATERIAL_ORDER_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <input
                      className="project-orders-notes-input"
                      value={row.notes}
                      placeholder="Notes"
                      onChange={(e) => setNotes(row.scope, row.index, e.target.value)}
                      aria-label={`Notes for ${row.product || row.label || "line"}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="project-orders-action-bar">
        <p className="project-orders-selection-summary muted small">
          {!hasChecked ? (
            "0 checked — check items to order"
          ) : (
            <>
              {`${checkedRows.length} checked`}
              {checkedWc.length > 0 &&
                ` · ${checkedWc.length} WC (${wcVendorCount} vendor${wcVendorCount === 1 ? "" : "s"})`}
              {checkedFrp.length > 0 &&
                ` · ${checkedFrp.length} FRP (${frpVendorCount} vendor${frpVendorCount === 1 ? "" : "s"})`}
              {missingQtyChecked > 0 && (
                <span className="project-orders-missing-qty">
                  {` · ${missingQtyChecked} missing qty`}
                </span>
              )}
            </>
          )}
        </p>
        <div className="project-orders-action-buttons row-gap wrap">
          {showWcActions && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => startDelivery({ kind: "wc_form" })}
            >
              WC order form PDF
            </button>
          )}
          {showFrpActions && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => startDelivery({ kind: "frp_form" })}
            >
              FRP order form PDF
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => startVendor({ kind: "email_order" })}
          >
            Email order
          </button>
        </div>
      </div>
      </section>

      <section className="card stack fwp-items-section project-orders-fwp">
        <div className="row-between wrap fwp-items-toolbar">
          <div>
            <h3>
              FWP (stretch fabric) <span className="muted">({trackDraft.items.length})</span>
            </h3>
            <p className="muted small project-orders-fwp-job">
              FWP job: {fwpPoJobCode || "—"}
              {fwpName ? ` — ${fwpName}` : ""}
            </p>
          </div>
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
            + Add item
          </button>
        </div>

        <div className="fwp-items-list">
          <div className="fwp-items-header" role="row">
            <span className="fwp-row-handle-spacer" aria-hidden="true" />
            <span className="fwp-col-head fwp-check-head" aria-hidden="true" />
            <span className="fwp-col-head fwp-col-type">Type</span>
            <span className="fwp-col-head fwp-col-product">Product</span>
            <span className="fwp-col-head fwp-col-code">Mat code</span>
            <span className="fwp-col-head fwp-qty-head">Qty</span>
            <span className="fwp-col-head fwp-col-head-actions" aria-hidden="true" />
          </div>
          {trackDraft.items.map((item, index) => (
            <TrackItemRow
              key={`fwp-${index}`}
              item={item}
              index={index}
              total={trackDraft.items.length}
              catalog={trackCatalog}
              usage={trackUsage}
              dragging={dragFrom === index}
              dragOver={dragOver === index}
              onChange={(patch) => patchFwpItem(index, patch)}
              onRemove={() =>
                setTrackDraft((d) => {
                  const next = d.items.filter((_, i) => i !== index);
                  return { ...d, items: next.length ? next : [emptyTrackItem()] };
                })
              }
              onDragStart={() => setDragFrom(index)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== index) setDragOver(index);
              }}
              onDragLeave={() => {
                if (dragOver === index) setDragOver(null);
              }}
              onDrop={() => {
                if (dragFrom != null && dragFrom !== index) {
                  setTrackDraft((d) => ({
                    ...d,
                    items: moveItem(d.items, dragFrom, index),
                  }));
                }
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            />
          ))}
        </div>

        <div className="fwp-items-footer row-gap wrap">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => startDelivery({ kind: "fwp_form" })}
          >
            Order form PDF
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => startVendor({ kind: "fwp_email_order" })}
          >
            Email order
          </button>
        </div>
      </section>

      {deliveryOpen && (
        <DeliveryAddressModal
          defaultAddress={jobFullAddressOneLine(project, project.jobInfo)}
          warehouseAddress={deliverySettings.default_delivery_address}
          companyAddress={settings.company_address}
          jobNumber={activePoJobCode}
          projectId={projectId}
          onRequestNextPo={() => previewNextMaterialOrderPo(activePoJobCode)}
          onConfirm={onDeliveryConfirmed}
          onClose={() => {
            setDeliveryOpen(false);
            setPendingAction(null);
            setConfirmedPo(null);
          }}
        />
      )}

      {emailOrderOpen && (
        <MaterialOrderEmailModal
          materialType={emailOrderMode === "fwp" ? "FWP" : emailMaterialType}
          jobNumber={emailOrderMode === "fwp" ? fwpPoJobCode : wcJobNumber}
          jobName={emailOrderMode === "fwp" ? fwpName || wcJobName : wcJobName}
          poNumber={emailOrderPo}
          deliveryAddress={pendingDeliveryAddress}
          specifier={project.architect}
          items={emailOrderMode === "fwp" ? fwpEmailOrderItems : emailOrderItems}
          delivery={deliverySettings}
          vendors={vendors}
          onDownloadPdfs={downloadEmailOrderPdfs}
          onClose={() => {
            setEmailOrderOpen(false);
            setPendingAction(null);
            setConfirmedPo(null);
          }}
        />
      )}
    </div>
  );
}

