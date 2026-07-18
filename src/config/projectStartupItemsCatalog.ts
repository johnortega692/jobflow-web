import type { StartupChecklistGroup, StartupChecklistSource } from "../lib/projectStartupItems";

export type StartupCatalogSeed = {
  id: string;
  group: StartupChecklistGroup;
  label: string;
  source: StartupChecklistSource;
  blocking?: boolean;
  /** Default enabled for new projects (true unless set false). */
  defaultEnabled?: boolean;
  /** Show due-date controls in Job setup. */
  dateSensitive?: boolean;
  /** Default off on paint-only jobs; auto-managed when wallcovering contract is toggled. */
  requiresWallcovering?: boolean;
};

export const STARTUP_CHECKLIST_GROUP_META: Record<
  StartupChecklistGroup,
  { label: string; icon: "file-certificate" | "color-swatch" | "shield-check" | "truck-delivery" | "receipt" }
> = {
  contract_compliance: { label: "Contract", icon: "file-certificate" },
  submittals_samples: { label: "Submittals", icon: "color-swatch" },
  safety: { label: "Safety", icon: "shield-check" },
  procurement_field: { label: "Procurement", icon: "truck-delivery" },
  billing: { label: "Billing", icon: "receipt" },
};

export const STARTUP_CHECKLIST_CATALOG: StartupCatalogSeed[] = [
  {
    id: "contract_review",
    group: "contract_compliance",
    label: "Complete contract review",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "job_start_form",
    group: "contract_compliance",
    label: "Complete Job Start Form",
    source: "manual",
    defaultEnabled: true,
  },
  {
    id: "executed_subcontract",
    group: "contract_compliance",
    label: "Return executed contract",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "coi_sent",
    group: "contract_compliance",
    label: "Send COI",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "request_preliminary_notice",
    group: "contract_compliance",
    label: "Request Preliminary notice",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "preliminary_notice_sent",
    group: "contract_compliance",
    label: "Send Preliminary notice",
    source: "manual",
    blocking: true,
    dateSensitive: true,
    defaultEnabled: true,
  },
  {
    id: "dir_registration",
    group: "contract_compliance",
    label: "Confirm DIR registration",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "certified_payroll",
    group: "contract_compliance",
    label: "Set up certified payroll",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "product_data_submitted",
    group: "submittals_samples",
    label: "Submit product data package",
    source: "jobTracker",
    defaultEnabled: true,
  },
  {
    id: "sds_package_sent",
    group: "submittals_samples",
    label: "Send SDS package",
    source: "sds",
    defaultEnabled: false,
  },
  {
    id: "color_finish_schedule",
    group: "submittals_samples",
    label: "Obtain color / finish schedule",
    source: "manual",
    defaultEnabled: true,
  },
  {
    id: "submit_brushouts",
    group: "submittals_samples",
    label: "Submit brushouts or wallcovering",
    source: "brushouts",
    defaultEnabled: true,
  },
  {
    id: "submit_wc_samples",
    group: "submittals_samples",
    label: "Submit WC samples",
    source: "manual",
    requiresWallcovering: true,
    defaultEnabled: false,
  },
  {
    id: "site_safety_plan",
    group: "safety",
    label: "Send Safety Plan",
    source: "manual",
    defaultEnabled: true,
  },
  {
    id: "jhas_scopes",
    group: "safety",
    label: "Prepare JHA",
    source: "manual",
    defaultEnabled: true,
  },
  {
    id: "crew_orientation",
    group: "safety",
    label: "Confirm crew orientation",
    source: "manual",
    defaultEnabled: true,
  },
  {
    id: "pos_issued",
    group: "procurement_field",
    label: "Issue POs / buy out material",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "wc_lead_times",
    group: "procurement_field",
    label: "Confirm WC lead times and dye lots",
    source: "manual",
    requiresWallcovering: true,
    defaultEnabled: false,
  },
  {
    id: "field_measure",
    group: "procurement_field",
    label: "Schedule field measure",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "staging_access",
    group: "procurement_field",
    label: "Confirm staging / access with GC",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "send_sov",
    group: "procurement_field",
    label: "Send SOV",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "approved_sov",
    group: "procurement_field",
    label: "Approved SOV (Sent)",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "schedule_obtained",
    group: "procurement_field",
    label: "Confirm schedule with GC",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "budget_enter_fsi",
    group: "billing",
    label: "Budget enter FSI",
    source: "manual",
    blocking: true,
    defaultEnabled: true,
  },
  {
    id: "billing_portal",
    group: "billing",
    label: "Set up billing portal",
    source: "manual",
    defaultEnabled: false,
  },
  {
    id: "billing_cutoff",
    group: "billing",
    label: "Confirm billing cutoff and lien waiver format",
    source: "manual",
    defaultEnabled: false,
  },
];

/** Legacy optional-task ids merged into the new checklist. */
export const LEGACY_OPTIONAL_MIGRATION_IDS = ["contract_review", "send_sov", "schedule_obtained"] as const;

export const STARTUP_SOURCE_LABELS: Record<StartupChecklistSource, string> = {
  manual: "Manual",
  jobTracker: "Job Tracker",
  brushouts: "Brushouts",
  sds: "SDS",
};

export function catalogSeedForId(id: string): StartupCatalogSeed | undefined {
  return STARTUP_CHECKLIST_CATALOG.find((s) => s.id === id);
}
