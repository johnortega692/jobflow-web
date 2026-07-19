import type { RfiFormData } from "../types/database";

export type RfiReadinessItem = {
  id: string;
  ok: boolean;
  /** When true, missing state is informational (never blocks / never warn-tint). */
  optional?: boolean;
  label: string;
};

export function evaluateRfiReadiness(form: RfiFormData): RfiReadinessItem[] {
  const questionOk = Boolean(form.question.trim());
  const actionOk =
    form.action_clarification || form.action_direction || form.action_approval;
  const dueOk = Boolean(form.due_date.trim());
  const reasonOk =
    form.reason_insufficient || form.reason_conflict || form.reason_alternate;

  return [
    {
      id: "question",
      ok: questionOk,
      label: questionOk ? "Question filled in" : "Question is empty",
    },
    {
      id: "action",
      ok: actionOk,
      label: actionOk ? "Action requested selected" : "No action requested selected",
    },
    {
      id: "due",
      ok: dueOk,
      label: dueOk ? "Due date set" : "Due date not set",
    },
    {
      id: "reason",
      ok: reasonOk,
      optional: true,
      label: reasonOk ? "Reason selected" : "Reason not selected (optional)",
    },
  ];
}
