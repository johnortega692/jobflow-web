export type ProjectModuleId =
  | "overview"
  | "rfis"
  | "submittals"
  | "procurement-log"
  | "sds"
  | "transmittal"
  | "excel-paste"
  | "paint"
  | "wallcovering"
  | "frp"
  | "orders"
  | "po"
  | "budget"
  | "billing"
  | "work-orders";

export type ProjectModule = {
  id: ProjectModuleId;
  label: string;
  path: string;
  ready: boolean;
  /** Hide unless job setup has wallcovering enabled. */
  requiresWallcovering?: boolean;
};

export type ProjectNavSection = {
  id: string;
  /** Uppercase section label; omit for unlabeled groups (Dashboard). */
  label?: string;
  modules: ProjectModule[];
};

export const PROJECT_NAV_SECTIONS: ProjectNavSection[] = [
  {
    id: "main",
    modules: [{ id: "overview", label: "Dashboard", path: "", ready: true }],
  },
  {
    id: "documents",
    label: "Documents",
    modules: [
      { id: "rfis", label: "RFIs", path: "rfis", ready: true },
      { id: "submittals", label: "Submittal Log", path: "submittals", ready: true },
      { id: "sds", label: "Submittal Package", path: "sds", ready: true },
      { id: "procurement-log", label: "Procurement Log", path: "procurement-log", ready: true, requiresWallcovering: true },
      { id: "transmittal", label: "Transmittal", path: "transmittal", ready: true },
      { id: "excel-paste", label: "Excel Templates", path: "excel-paste", ready: true },
    ],
  },
  {
    id: "scopes",
    label: "Scopes",
    modules: [
      { id: "paint", label: "Paint", path: "paint", ready: true },
      { id: "wallcovering", label: "Wallcovering", path: "wallcovering", ready: true },
      { id: "frp", label: "FRP", path: "frp", ready: true },
    ],
  },
  {
    id: "orders",
    label: "Orders",
    modules: [
      { id: "po", label: "PO", path: "po", ready: true },
      { id: "orders", label: "Material orders", path: "orders", ready: true },
    ],
  },
  {
    id: "tracking",
    label: "Tracking",
    modules: [
      { id: "budget", label: "Budget", path: "budget", ready: true },
      { id: "billing", label: "Manpower", path: "billing", ready: true },
      { id: "work-orders", label: "Work Orders", path: "work-orders", ready: true },
    ],
  },
];

/** Flat list for route matching and lookups. */
export const PROJECT_MODULES: ProjectModule[] = PROJECT_NAV_SECTIONS.flatMap((s) => s.modules);
