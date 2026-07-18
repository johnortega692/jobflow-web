/** Manual startup steps — order matches the dashboard stepper left → right. */
export const PROJECT_STARTUP_ACTIONS = {
  open_job_setup: "open_job_setup",
  open_approved_brushouts: "open_approved_brushouts",
} as const;

export type ProjectStartupAction = (typeof PROJECT_STARTUP_ACTIONS)[keyof typeof PROJECT_STARTUP_ACTIONS];

export const PROJECT_STARTUP_STEPS = [
  {
    id: "field_request_app",
    label: "Field Tools & Manpower synced (PM, super, address in job setup)",
    shortLabel: "Field app",
    action: PROJECT_STARTUP_ACTIONS.open_job_setup,
  },
  {
    id: "wc_samples_ordered",
    label: "Wallcovering samples ordered",
    shortLabel: "Samples",
    modulePath: "submittals/wallcovering",
    requiresWallcovering: true, // Job Setup → "includes wallcovering" toggle
  },
  {
    id: "brushouts_ordered",
    label: "Approve brush-outs for Field Tools",
    shortLabel: "Brush outs",
    action: PROJECT_STARTUP_ACTIONS.open_approved_brushouts,
    modulePath: "submittals/paint",
  },
  {
    id: "field_has_hours",
    label: "Field has hours",
    shortLabel: "Hours",
  },
  {
    id: "autodesk_plans",
    label: "Setup Autodesk and add plans",
    shortLabel: "Autodesk",
  },
  {
    id: "budget_done",
    label: "Budget done",
    shortLabel: "Budget",
    modulePath: "budget",
  },
] as const;

export type ProjectStartupStepId = (typeof PROJECT_STARTUP_STEPS)[number]["id"];

export const JOB_INFO_STARTUP_STEP = {
  id: "job_info",
  label: "Job info setup complete",
  shortLabel: "Job info",
} as const;
