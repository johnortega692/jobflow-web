import type { RfiFormData } from "../types/database";

/** Checkbox / chip labels shared by RFI editor and PDF output. */

export const RFI_REASON_LABELS = {
  reason_insufficient: "Insufficient information",
  reason_conflict: "Conflict in documents",
  reason_alternate: "Alternate proposed",
} as const;

export const RFI_ACTION_LABELS = {
  action_clarification: "Clarification",
  action_direction: "Direction",
  action_approval: "Approval",
} as const;

export type RfiImpactChoice = "no_change" | "increase" | "decrease" | "tbd";

export const RFI_IMPACT_OPTIONS: readonly { value: RfiImpactChoice; label: string }[] = [
  { value: "no_change", label: "No change" },
  { value: "increase", label: "Increase" },
  { value: "decrease", label: "Decrease" },
  { value: "tbd", label: "Unknown / TBD" },
];

const IMPACT_PRINT_LABEL: Record<RfiImpactChoice, string> = {
  no_change: "no change",
  increase: "increase",
  decrease: "decrease",
  tbd: "TBD",
};

export type RfiCheckboxField =
  | keyof typeof RFI_REASON_LABELS
  | keyof typeof RFI_ACTION_LABELS
  | "effect_increase_cost"
  | "effect_increase_time"
  | "effect_decrease_cost"
  | "effect_decrease_time"
  | "effect_unknown_cost"
  | "effect_unknown_time";

export function rfiCheckboxChecked(form: RfiFormData, key: RfiCheckboxField): boolean {
  return Boolean(form[key as keyof RfiFormData]);
}

/** True when legacy cost/schedule text is empty or a TBD placeholder. */
export function isRfiImpactAmountPlaceholder(value: string): boolean {
  const t = value.trim();
  return !t || t.toUpperCase() === "TBD";
}

export function rfiCostImpact(form: Pick<RfiFormData, "effect_increase_cost" | "effect_decrease_cost" | "effect_unknown_cost">): RfiImpactChoice {
  if (form.effect_increase_cost) return "increase";
  if (form.effect_decrease_cost) return "decrease";
  if (form.effect_unknown_cost) return "tbd";
  return "no_change";
}

export function rfiScheduleImpact(
  form: Pick<RfiFormData, "effect_increase_time" | "effect_decrease_time" | "effect_unknown_time">,
): RfiImpactChoice {
  if (form.effect_increase_time) return "increase";
  if (form.effect_decrease_time) return "decrease";
  if (form.effect_unknown_time) return "tbd";
  return "no_change";
}

export function rfiCostImpactFlags(choice: RfiImpactChoice): Pick<
  RfiFormData,
  "effect_increase_cost" | "effect_decrease_cost" | "effect_unknown_cost"
> {
  return {
    effect_increase_cost: choice === "increase",
    effect_decrease_cost: choice === "decrease",
    effect_unknown_cost: choice === "tbd",
  };
}

export function rfiScheduleImpactFlags(choice: RfiImpactChoice): Pick<
  RfiFormData,
  "effect_increase_time" | "effect_decrease_time" | "effect_unknown_time"
> {
  return {
    effect_increase_time: choice === "increase",
    effect_decrease_time: choice === "decrease",
    effect_unknown_time: choice === "tbd",
  };
}

/** Coerce legacy multi-select effect flags + TBD text amounts into the single-select impact model. */
export function normalizeRfiImpactFields(form: RfiFormData): RfiFormData {
  const cost = rfiCostImpact(form);
  const schedule = rfiScheduleImpact(form);
  return {
    ...form,
    ...rfiCostImpactFlags(cost),
    ...rfiScheduleImpactFlags(schedule),
    cost_change: isRfiImpactAmountPlaceholder(form.cost_change) ? "" : form.cost_change,
    sched_change: isRfiImpactAmountPlaceholder(form.sched_change) ? "" : form.sched_change,
  };
}

function formatImpactPart(
  label: string,
  choice: RfiImpactChoice,
  amount: string,
  kind: "cost" | "schedule",
): string {
  const choiceLabel = IMPACT_PRINT_LABEL[choice];
  const amt = amount.trim();
  if ((choice === "increase" || choice === "decrease") && amt) {
    if (kind === "cost") return `${label}: ${choiceLabel} (${amt} est.)`;
    return `${label}: ${choiceLabel} (${amt} days)`;
  }
  return `${label}: ${choiceLabel}`;
}

/** Single impact summary line for PDF / print (replaces probable-effect checkboxes). */
export function formatRfiImpactSummary(form: RfiFormData): string {
  return [
    formatImpactPart("Cost", rfiCostImpact(form), form.cost_change, "cost"),
    formatImpactPart("Schedule", rfiScheduleImpact(form), form.sched_change, "schedule"),
  ].join(" · ");
}
