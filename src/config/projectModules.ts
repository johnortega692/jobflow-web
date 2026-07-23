export type ProjectModuleId =
  | "overview"
  | "rfis"
  | "submittals"
  | "excel-paste"
  | "orders"
  | "po"
  | "budget"
  | "billing"
  | "work-orders"
  | "material-tracker";

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

/** Nested routes under /submittals — not separate sidebar detail pages. */
export const PROJECT_DETAIL_MODULE_IDS = new Set<ProjectModuleId>(["rfis", "work-orders"]);

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
      { id: "submittals", label: "Submittals", path: "submittals", ready: true },
      { id: "excel-paste", label: "Excel Templates", path: "excel-paste", ready: true },
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
      { id: "material-tracker", label: "Material Tracker", path: "material-tracker", ready: true },
      { id: "budget", label: "Budget Maker", path: "budget", ready: true },
      { id: "billing", label: "Labor Projection", path: "billing", ready: true },
      { id: "work-orders", label: "Work Orders", path: "work-orders", ready: true },
    ],
  },
];

/** Flat list for route matching and lookups. */
export const PROJECT_MODULES: ProjectModule[] = PROJECT_NAV_SECTIONS.flatMap((s) => s.modules);
