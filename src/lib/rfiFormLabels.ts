import type { RfiFormData } from "../types/database";

/** Checkbox labels shared by RFI editor and PDF output. */

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

type RfiEffectKey =
  | "effect_increase_cost"
  | "effect_increase_time"
  | "effect_decrease_cost"
  | "effect_decrease_time"
  | "effect_unknown_cost"
  | "effect_unknown_time";

/** Order matches the RFI editor UI (cost/time pairs). */
export const RFI_EFFECT_LABELS: readonly { key: RfiEffectKey; label: string }[] = [
  { key: "effect_increase_cost", label: "Increase cost" },
  { key: "effect_increase_time", label: "Increase time" },
  { key: "effect_decrease_cost", label: "Decrease cost" },
  { key: "effect_decrease_time", label: "Decrease time" },
  { key: "effect_unknown_cost", label: "Unknown cost" },
  { key: "effect_unknown_time", label: "Unknown time" },
];

export type RfiCheckboxField = keyof typeof RFI_REASON_LABELS | keyof typeof RFI_ACTION_LABELS | RfiEffectKey;

export function rfiCheckboxChecked(form: RfiFormData, key: RfiCheckboxField): boolean {
  return Boolean(form[key as keyof RfiFormData]);
}
