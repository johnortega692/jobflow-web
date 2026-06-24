/** Manual startup steps — order matches the dashboard stepper left → right. */
export const PROJECT_STARTUP_ACTIONS = {
  field_request_job: "field_request_job",
  field_request_brushouts: "field_request_brushouts",
} as const;

export type ProjectStartupAction = (typeof PROJECT_STARTUP_ACTIONS)[keyof typeof PROJECT_STARTUP_ACTIONS];

export const PROJECT_STARTUP_STEPS = [
  {
    id: "field_request_app",
    label: "Add job to Field Request sheet",
    shortLabel: "Field app",
    action: PROJECT_STARTUP_ACTIONS.field_request_job,
  },
  {
    id: "wc_samples_ordered",
    label: "Wallcovering samples ordered",
    shortLabel: "Samples",
    modulePath: "wallcovering",
    requiresWallcovering: true, // Job Setup → "includes wallcovering" toggle
  },
  {
    id: "brushouts_ordered",
    label: "Push approved brush-outs to Field Request",
    shortLabel: "Brush outs",
    action: PROJECT_STARTUP_ACTIONS.field_request_brushouts,
    modulePath: "paint",
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
