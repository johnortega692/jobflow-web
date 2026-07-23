/** Informational office roles (profiles.job_role) — admin-assigned, not permissions. */

export const JOB_ROLE_OPTIONS = [
  { value: "", label: "— Not set —" },
  { value: "pm", label: "Project Manager" },
  { value: "super", label: "Superintendent" },
  { value: "foreman", label: "Foreman" },
  { value: "estimator", label: "Estimator" },
  { value: "pe", label: "Project Engineer" },
  { value: "admin", label: "Office Admin" },
] as const;

export type JobRoleSlug = (typeof JOB_ROLE_OPTIONS)[number]["value"];

export function jobRoleLabel(slug: string): string {
  const key = slug.trim().toLowerCase();
  const hit = JOB_ROLE_OPTIONS.find((o) => o.value === key);
  return hit?.label ?? (key ? slug : "— Not set —");
}

export function normalizeJobRoleSlug(raw: string): JobRoleSlug {
  const key = raw.trim().toLowerCase();
  return (JOB_ROLE_OPTIONS.some((o) => o.value === key) ? key : "") as JobRoleSlug;
}

export function userJobRoleIsPm(jobRole: string): boolean {
  return jobRole.trim().toLowerCase() === "pm";
}

export function userJobRoleIsSuper(jobRole: string): boolean {
  return jobRole.trim().toLowerCase() === "super";
}

/** PM or app admin may set start/finish and Add week on Labor Projection. */
export function canEditManpowerSchedule(jobRole: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return userJobRoleIsPm(jobRole);
}

/**
 * Cell enter/edit/clear on Labor Projection.
 * Office: any approved user. Field PIN sessions have no jobRole — always cells-only.
 */
export function canEditManpowerCells(_jobRole: string, _isAdmin: boolean): boolean {
  return true;
}
