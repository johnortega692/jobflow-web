/** Optional per-project startup tasks — enabled in Job setup, checked off on the dashboard. */
export const PROJECT_STARTUP_OPTIONAL_STEPS = [
  { id: "contract_review", label: "Contract review complete" },
  { id: "send_sov", label: "Send SOV" },
  { id: "schedule_obtained", label: "Obtain / confirm schedule" },
  { id: "notice_to_proceed", label: "Notice to proceed (NTP)" },
  { id: "precon_meeting", label: "Pre-construction meeting" },
  { id: "coi_received", label: "COI / insurance received" },
  { id: "submittal_log_ready", label: "Submittal log set up" },
  { id: "buyout_complete", label: "Buyout complete" },
  { id: "site_logistics", label: "Site logistics / laydown plan" },
  { id: "safety_plan", label: "Safety plan / IIPP" },
] as const;

export type ProjectStartupOptionalStepId = (typeof PROJECT_STARTUP_OPTIONAL_STEPS)[number]["id"];

export function optionalStepLabel(id: string, custom?: { id: string; label: string }[]): string {
  const catalog = PROJECT_STARTUP_OPTIONAL_STEPS.find((s) => s.id === id);
  if (catalog) return catalog.label;
  return custom?.find((c) => c.id === id)?.label.trim() || id;
}
