import type { WcFieldStatus } from "./fieldTrackerStatus";
import type { WcTrackerLineState } from "../types/fieldTracker";
import type { WallcoveringItem } from "../types/tradeDocuments";

export const WC_COMPONENT_TYPES = ["trim", "core", "fabric", "mounting"] as const;
export type WcComponentType = (typeof WC_COMPONENT_TYPES)[number];

export const WC_COMPONENT_TYPE_LABEL: Record<WcComponentType, string> = {
  trim: "Trim",
  core: "Core",
  fabric: "Fabric",
  mounting: "Mounting",
};

const WC_COMPONENT_TAG: Record<WcComponentType, string> = {
  trim: "TR",
  core: "CR",
  fabric: "FB",
  mounting: "MT",
};

export type WcComponentSubmittalMode = "sample" | "data" | "track";
export type WcShipTo = "jobsite" | "fabricator" | "shop";
export type WcFabricStage = "" | "ordered" | "at_fabricator" | "in_fabrication" | "shipped" | "delivered";

export const WC_FABRIC_STAGES: { id: Exclude<WcFabricStage, "">; label: string }[] = [
  { id: "ordered", label: "Fabric ordered" },
  { id: "at_fabricator", label: "At fabricator" },
  { id: "in_fabrication", label: "In fabrication" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
];

export type WcComponent = {
  id: string;
  type: WcComponentType;
  tag: string;
  item: string;
  finish: string;
  vendor: string;
  qty: string;
  unit: string;
  shipTo: WcShipTo;
  submittal: WcComponentSubmittalMode;
  fromGotTrack: boolean;
  ordered: boolean;
  sentForApproval: boolean;
  revision: boolean;
  approved: boolean;
  materialOrder: boolean;
  delivered: boolean;
  dateOrdered: string;
  shipDate: string;
  tracking: string;
  fabricStage: WcFabricStage;
  yardsRequired: string;
  yardsSent: string;
};

const TYPE_DEFAULTS: Record<WcComponentType, { unit: string; submittal: WcComponentSubmittalMode; shipTo: WcShipTo }> = {
  trim: { unit: "LF", submittal: "track", shipTo: "jobsite" },
  core: { unit: "SF", submittal: "data", shipTo: "jobsite" },
  fabric: { unit: "YD", submittal: "sample", shipTo: "fabricator" },
  mounting: { unit: "EA", submittal: "track", shipTo: "jobsite" },
};

export function componentTag(parentLabel: string, type: WcComponentType): string {
  const parent = parentLabel.trim();
  return parent ? `${parent}-${WC_COMPONENT_TAG[type]}` : WC_COMPONENT_TAG[type];
}

export function emptyWcComponent(type: WcComponentType = "trim", parentLabel = ""): WcComponent {
  const defaults = TYPE_DEFAULTS[type];
  return {
    id: crypto.randomUUID(),
    type,
    tag: componentTag(parentLabel, type),
    item: "",
    finish: "",
    vendor: "",
    qty: "",
    unit: defaults.unit,
    shipTo: defaults.shipTo,
    submittal: defaults.submittal,
    fromGotTrack: false,
    ordered: false,
    sentForApproval: false,
    revision: false,
    approved: false,
    materialOrder: false,
    delivered: false,
    dateOrdered: "",
    shipDate: "",
    tracking: "",
    fabricStage: "",
    yardsRequired: "",
    yardsSent: "",
  };
}

function asType(value: unknown): WcComponentType {
  return WC_COMPONENT_TYPES.includes(value as WcComponentType) ? (value as WcComponentType) : "trim";
}

function asMode(value: unknown, fallback: WcComponentSubmittalMode): WcComponentSubmittalMode {
  return value === "sample" || value === "data" || value === "track" ? value : fallback;
}

function asShip(value: unknown, fallback: WcShipTo): WcShipTo {
  return value === "jobsite" || value === "fabricator" || value === "shop" ? value : fallback;
}

function asFabricStage(value: unknown): WcFabricStage {
  return WC_FABRIC_STAGES.some((stage) => stage.id === value) ? (value as WcFabricStage) : "";
}

export function normalizeWcComponent(raw: unknown, parentLabel = ""): WcComponent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Partial<WcComponent>;
  const type = asType(row.type);
  const defaults = TYPE_DEFAULTS[type];
  const base = emptyWcComponent(type, parentLabel);
  return {
    ...base,
    id: String(row.id ?? base.id),
    type,
    tag: String(row.tag ?? "").trim() || componentTag(parentLabel, type),
    item: String(row.item ?? ""),
    finish: String(row.finish ?? ""),
    vendor: String(row.vendor ?? ""),
    qty: String(row.qty ?? ""),
    unit: String(row.unit ?? "").trim() || defaults.unit,
    shipTo: asShip(row.shipTo, defaults.shipTo),
    submittal: asMode(row.submittal, defaults.submittal),
    fromGotTrack: Boolean(row.fromGotTrack),
    ordered: Boolean(row.ordered),
    sentForApproval: Boolean(row.sentForApproval),
    revision: Boolean(row.revision),
    approved: Boolean(row.approved),
    materialOrder: Boolean(row.materialOrder),
    delivered: Boolean(row.delivered),
    dateOrdered: String(row.dateOrdered ?? ""),
    shipDate: String(row.shipDate ?? ""),
    tracking: String(row.tracking ?? ""),
    fabricStage: asFabricStage(row.fabricStage),
    yardsRequired: String(row.yardsRequired ?? ""),
    yardsSent: String(row.yardsSent ?? ""),
  };
}

export function refreshComponentTags(items: WallcoveringItem[]): WallcoveringItem[] {
  return items.map((item) => ({
    ...item,
    components: normalizeWcComponents(item.components, item.label).map((component) => ({
      ...component,
      tag: componentTag(item.label, component.type),
    })),
  }));
}

export function normalizeWcComponents(raw: unknown, parentLabel = ""): WcComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => normalizeWcComponent(row, parentLabel))
    .filter((row): row is WcComponent => row !== null);
}

export function isApsTrackItem(item: { manufacturer?: string; product?: string }): boolean {
  return (
    String(item.product ?? "").trim() === "Track and Infill" &&
    String(item.manufacturer ?? "").trim().toUpperCase() === "APS"
  );
}

export function isUntouchedGotTrack(component: WcComponent): boolean {
  return (
    component.fromGotTrack &&
    component.type === "trim" &&
    component.item.trim() === "Track and Infill" &&
    component.vendor.trim().toUpperCase() === "APS"
  );
}

export function defaultGotTrackComponent(parentLabel: string): WcComponent {
  return {
    ...emptyWcComponent("trim", parentLabel),
    item: "Track and Infill",
    vendor: "APS",
    fromGotTrack: true,
  };
}

/** Drop the old job-level APS row and hang that trim on each finish that lacks one. */
export function migrateTrackItems(items: WallcoveringItem[]): WallcoveringItem[] {
  const track = items.find(isApsTrackItem);
  const rest = items.filter((item) => !isApsTrackItem(item));
  if (!track) return rest.length ? rest : items;
  return rest.map((item) => {
    const components = normalizeWcComponents(item.components, item.label);
    if (components.some((component) => component.type === "trim")) {
      return { ...item, components };
    }
    const added = defaultGotTrackComponent(item.label);
    added.qty = track.qty?.trim() || added.qty;
    added.unit = track.unit?.trim() || added.unit;
    return { ...item, components: [...components, added] };
  });
}

export function applyGotTrackComponents(items: WallcoveringItem[], checked: boolean): WallcoveringItem[] {
  const content = items.filter((item) => !isApsTrackItem(item));
  const base = content.length ? content : items;
  if (checked) {
    return base.map((item) => {
      const components = normalizeWcComponents(item.components, item.label);
      if (components.some((component) => component.type === "trim")) {
        return { ...item, components };
      }
      return { ...item, components: [...components, defaultGotTrackComponent(item.label)] };
    });
  }
  return base.map((item) => ({
    ...item,
    components: normalizeWcComponents(item.components, item.label).filter((component) => !isUntouchedGotTrack(component)),
  }));
}

export function hasGotTrack(items: WallcoveringItem[]): boolean {
  return items.some(
    (item) =>
      isApsTrackItem(item) ||
      normalizeWcComponents(item.components, item.label).some((component) => component.type === "trim" && component.fromGotTrack),
  );
}

const PROCUREMENT_KEYS = [
  "ordered",
  "sentForApproval",
  "revision",
  "approved",
  "materialOrder",
  "delivered",
  "dateOrdered",
  "shipDate",
  "tracking",
  "fabricStage",
  "yardsRequired",
  "yardsSent",
] as const;

/** Copy submittal wording onto the tracker line and keep procurement status. */
export function mergeLineComponents(line: WcTrackerLineState, design: WcComponent[]): WcTrackerLineState {
  const existing = line.components ?? [];
  const merged = design.map((next) => {
    const prev = existing.find((component) => component.id === next.id);
    if (!prev) return next;
    const kept = { ...prev };
    return { ...next, ...Object.fromEntries(PROCUREMENT_KEYS.map((key) => [key, kept[key]])) } as WcComponent;
  });
  const extras = existing.filter((component) => !design.some((next) => next.id === component.id));
  return { ...line, components: [...merged, ...extras] };
}

export function applySubmittalComponents(
  lines: WcTrackerLineState[],
  items: WallcoveringItem[],
): WcTrackerLineState[] {
  return lines.map((line) => {
    const match = items.find((item) => item.label.trim() && item.label.trim() === line.label.trim());
    if (!match) return { ...line, components: line.components ?? [] };
    return {
      ...mergeLineComponents(line, normalizeWcComponents(match.components, match.label)),
      panels: line.panels || Boolean(match.panels),
      fabricatedAssembly: Boolean(match.fabricatedAssembly),
      shopDrawings: Boolean(match.shopDrawings),
      e84ClassA: Boolean(match.e84ClassA),
    };
  });
}

export function componentStatus(component: WcComponent): WcFieldStatus {
  if (component.type === "fabric" && component.shipTo === "fabricator" && component.fabricStage) {
    if (component.fabricStage === "delivered") return "Delivered";
    if (component.fabricStage === "shipped" || component.fabricStage === "in_fabrication" || component.fabricStage === "at_fabricator") {
      return "Material Ordered";
    }
    return "Submittal Ordered";
  }
  if (component.delivered) return "Delivered";
  if (component.materialOrder) return "Material Ordered";
  if (component.revision && !component.approved) return "Needs Revision";
  if (component.approved) return "Approved";
  if (component.sentForApproval) return "Submitted for Approval";
  if (component.ordered) return "Submittal Ordered";
  return "Not Started";
}

export function applyComponentStage(component: WcComponent, stage: WcFieldStatus): WcComponent {
  if (component.type === "fabric" && component.shipTo === "fabricator") {
    const fabric: Record<string, WcFabricStage> = {
      "Not Started": "",
      "Submittal Ordered": "ordered",
      "Submitted for Approval": "ordered",
      Approved: "at_fabricator",
      "Material Ordered": "in_fabrication",
      Delivered: "delivered",
      "Needs Revision": "ordered",
    };
    return { ...component, fabricStage: fabric[stage] ?? component.fabricStage, revision: stage === "Needs Revision" };
  }
  if (stage === "Needs Revision") {
    return { ...component, ordered: true, sentForApproval: true, revision: true, approved: false, materialOrder: false, delivered: false };
  }
  const order: WcFieldStatus[] = [
    "Submittal Ordered",
    "Submitted for Approval",
    "Approved",
    "Material Ordered",
    "Delivered",
  ];
  const reached = order.indexOf(stage);
  return {
    ...component,
    ordered: reached >= 0,
    sentForApproval: reached >= 1,
    revision: false,
    approved: reached >= 2,
    materialOrder: reached >= 3,
    delivered: reached >= 4,
  };
}

export function fabricAtFabricator(component: WcComponent): boolean {
  const rank = ["", "ordered", "at_fabricator", "in_fabrication", "shipped", "delivered"];
  return rank.indexOf(component.fabricStage) >= rank.indexOf("at_fabricator");
}

/** Panels cannot start fabrication until COM fabric has reached the fabricator. */
export function panelFabricationBlocked(line: WcTrackerLineState): boolean {
  if (!line.panels) return false;
  return (line.components ?? []).some(
    (component) =>
      component.type === "fabric" &&
      component.shipTo === "fabricator" &&
      !fabricAtFabricator(component),
  );
}

function componentBlocksInstall(component: WcComponent): boolean {
  if (component.shipTo !== "jobsite") return false;
  return !component.delivered;
}

export function isApsTrackerLine(line: {
  wallcoveringName?: string;
  manufacturer?: string;
  product?: string;
}): boolean {
  if (isApsTrackItem(line)) return true;
  const name = `${line.manufacturer ?? ""} ${line.product ?? ""} ${line.wallcoveringName ?? ""}`.toLowerCase();
  return name.includes("aps") && name.includes("track and infill");
}

/** Drop the old tracker APS row and copy its procurement onto untouched trim components. */
export function migrateApsTrackerLine(lines: WcTrackerLineState[]): WcTrackerLineState[] {
  const aps = lines.find(isApsTrackerLine);
  if (!aps) return lines;
  return lines
    .filter((line) => line !== aps)
    .map((line) => {
      let components = line.components ?? [];
      if (!components.some((component) => component.type === "trim")) {
        components = [...components, defaultGotTrackComponent(line.label)];
      }
      return {
        ...line,
        components: components.map((component) => {
          if (!isUntouchedGotTrack(component)) return component;
          if (component.ordered || component.materialOrder || component.delivered) return component;
          return {
            ...component,
            qty: component.qty.trim() || aps.orderQty,
            unit: component.unit.trim() || aps.orderUnit || component.unit,
            ordered: aps.ordered,
            sentForApproval: aps.sentForApproval,
            approved: aps.approved,
            materialOrder: aps.materialOrder,
            delivered: aps.delivered,
            dateOrdered: component.dateOrdered.trim() || aps.dateOrdered,
            shipDate: component.shipDate.trim() || aps.shipDate,
            tracking: component.tracking.trim() || aps.tracking,
          };
        }),
      };
    });
}

export function installReady(line: WcTrackerLineState): { ready: boolean; waiting: string } {
  const parentDelivered = line.delivered;
  const blocking = (line.components ?? []).find(componentBlocksInstall);
  if (!parentDelivered) return { ready: false, waiting: "" };
  if (!blocking) return { ready: true, waiting: "" };
  return { ready: false, waiting: WC_COMPONENT_TYPE_LABEL[blocking.type] };
}

export function installReadyCount(lines: WcTrackerLineState[]): { ready: number; total: number } {
  return {
    ready: lines.filter((line) => installReady(line).ready).length,
    total: lines.length,
  };
}

export function componentOnPdf(component: WcComponent): boolean {
  return component.submittal !== "track" && Boolean(component.item.trim() || component.finish.trim() || component.vendor.trim());
}

export function submittalModeLabel(mode: WcComponentSubmittalMode): string {
  if (mode === "sample") return "Include sample";
  if (mode === "data") return "Include data";
  return "Track only";
}

export function shipToLabel(shipTo: WcShipTo): string {
  if (shipTo === "fabricator") return "Fabricator";
  if (shipTo === "shop") return "Shop";
  return "Jobsite";
}
