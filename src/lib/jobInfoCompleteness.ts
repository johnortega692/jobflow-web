import type { ProjectForm } from "../types/database";

const CORE_FIELDS: { label: string; filled: (p: ProjectForm) => boolean }[] = [
  { label: "Job #", filled: (p) => Boolean(p.job_number.trim()) },
  { label: "Job name", filled: (p) => Boolean(p.job_name.trim()) },
  { label: "Job address", filled: (p) => Boolean(p.job_address.trim()) },
  { label: "GC name", filled: (p) => Boolean(p.contractor.trim()) },
  { label: "Start date", filled: (p) => Boolean(p.jobInfo.start_date.trim()) },
];

export function jobSetupStatus(project: ProjectForm): { complete: boolean; missing: string[] } {
  const missing = CORE_FIELDS.filter((f) => !f.filled(project)).map((f) => f.label);
  return { complete: missing.length === 0, missing };
}
