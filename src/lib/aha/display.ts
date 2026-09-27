import type { AhaLibraryStep, AhaProb, AhaScope, AhaSev, AhaStandard, AhaStatus, AhaStep, ProjectAha } from "./types";

export const AHA_PROBABILITIES: { value: AhaProb; label: string }[] = [
  { value: "F", label: "Frequent" },
  { value: "L", label: "Likely" },
  { value: "O", label: "Occasional" },
  { value: "S", label: "Seldom" },
  { value: "U", label: "Unlikely" },
];

export const AHA_SEVERITIES: { value: AhaSev; label: string }[] = [
  { value: "C", label: "Catastrophic" },
  { value: "R", label: "Critical" },
  { value: "M", label: "Marginal" },
  { value: "N", label: "Negligible" },
];

export const RAC_KEY: { level: "E" | "H" | "M" | "L"; label: string }[] = [
  { level: "E", label: "Extremely high" },
  { level: "H", label: "High" },
  { level: "M", label: "Moderate" },
  { level: "L", label: "Low" },
];

export function ahaScopeLabel(scope: AhaScope): string {
  if (scope === "paint") return "Paint";
  if (scope === "wallcovering") return "Wallcovering";
  if (scope === "access") return "Access";
  return "General";
}

export function ahaStatusLabel(status: AhaStatus): string {
  if (status === "submitted") return "Submitted";
  if (status === "accepted") return "Accepted";
  return "Draft";
}

export function ahaFileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "aha";
}

export function ahaPdfFilename(jobNumber: string, name: string, standard: AhaStandard): string {
  const kind = standard === "calosha" ? "JHA" : "AHA";
  return `${jobNumber.trim()}_${kind}_${ahaFileSlug(name)}.pdf`;
}

/** Prefix "OSHA " only for CFR section numbers. Other notes print as written. */
export function formatOshaRef(refs: string): string {
  const text = refs.trim();
  if (!text) return "";
  return /^\d/.test(text) ? `OSHA ${text}` : text;
}

export function suggestedAhaName(scopes: AhaScope[]): string {
  const deciding = scopes.filter((scope) => scope === "paint" || scope === "wallcovering");
  if (!deciding.length) return "";
  const unique = new Set(deciding);
  if (unique.has("paint") && !unique.has("wallcovering")) return "Painting";
  if (unique.size === 1 && unique.has("wallcovering")) return "Wallcovering";
  return "";
}

export function mergedAhaScope(scopes: AhaScope[]): AhaScope {
  if (!scopes.length) return "paint";
  const unique = new Set(scopes);
  if (unique.size === 1) return scopes[0]!;
  if (unique.has("paint") && !unique.has("wallcovering")) return "paint";
  return scopes[0]!;
}

/** Keep the first spelling of each item. Comparison ignores case and surrounding space. */
export function mergeUniqueText(current: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...current, ...incoming]) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged;
}

export function copyLibrarySteps(steps: AhaLibraryStep[]): AhaStep[] {
  return steps.map((step) => ({
    ...blankAhaStep(),
    name: step.name,
    hazards: [...step.hazards],
    controls: [...step.controls],
    osha_refs: step.osha_refs,
    em385_refs: step.em385_refs,
    prob: step.prob,
    sev: step.sev,
  }));
}

export function blankAhaStep(): AhaStep {
  return {
    id: crypto.randomUUID(),
    name: "",
    hazards: [],
    controls: [],
    osha_refs: "",
    em385_refs: "",
    prob: "O",
    sev: "M",
  };
}

export function cleanAhaStep(step: AhaStep): AhaStep {
  return {
    ...step,
    name: step.name.trim(),
    hazards: step.hazards.map((line) => line.trim()).filter(Boolean),
    controls: step.controls.map((line) => line.trim()).filter(Boolean),
    osha_refs: step.osha_refs.trim(),
    em385_refs: step.em385_refs.trim(),
  };
}

export type AhaReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
};

export function ahaReadiness(
  aha: Pick<ProjectAha, "steps" | "competent_person" | "foreman" | "competent_persons" | "options">,
  emergency: { nearest_hospital: string; emergency_contacts: { name: string; phone: string }[] } | null,
  action: "Save" | "Download" = "Save",
): { items: AhaReadinessItem[]; confirmMessage: string | null } {
  const count = aha.steps.length;
  const stepLabel = count === 1 ? "1 step, each with a RAC" : `${count} steps, each with a RAC`;
  const calosha = aha.options.standard === "calosha";
  const items: AhaReadinessItem[] = [
    { id: "steps", label: stepLabel, ok: count >= 1 },
    calosha
      ? { id: "foreman", label: "Foreman named", ok: aha.foreman.trim().length > 0 }
      : { id: "competent", label: "Competent person named", ok: aha.competent_person.trim().length > 0 },
  ];
  if (calosha) {
    const assigned = aha.competent_persons.filter((row) => !row.na);
    items.push({
      id: "competent-names",
      label: "Every non-N/A competent-person row has a name",
      ok: assigned.every((row) => row.employee.trim().length > 0),
    });
  } else if (aha.options.show_refs) {
    items.push({
      id: "em385",
      label: "EM 385-1-1 refs added",
      ok: count > 0 && aha.steps.every((step) => step.em385_refs.trim().length > 0),
    });
  }
  const hospital = emergency?.nearest_hospital.trim() ?? "";
  const hasContact = emergency?.emergency_contacts.some((row) => row.name.trim() || row.phone.trim()) ?? false;
  items.push({
    id: "emergency",
    label: "Emergency info complete",
    ok: hospital.length > 0 && hasContact,
  });
  const missing = items.filter((item) => !item.ok);
  return {
    items,
    confirmMessage: missing.length
      ? `${missing.map((item) => item.label).join(". ")}. ${action} anyway?`
      : null,
  };
}
