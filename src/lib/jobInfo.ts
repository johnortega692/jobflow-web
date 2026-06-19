import type { Project } from "../types/database";
import { defaultJobInfo, type JobInfoData } from "../types/jobInfo";
import type { TransmittalData } from "../types/tradeDocuments";

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Parse job_info from projects.data, seeded from top-level columns when empty. */
export function normalizeJobInfo(raw: unknown, project: Pick<Project, "contractor" | "architect" | "owner" | "job_address2">): JobInfoData {
  const base = defaultJobInfo();
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const info: JobInfoData = {
    ...base,
    job_date: str(o.job_date),
    job_city: str(o.job_city),
    job_zip: str(o.job_zip),
    job_county: str(o.job_county),
    job_type: str(o.job_type) || base.job_type,
    job_cost_type: str(o.job_cost_type) || base.job_cost_type,
    contract_amount: str(o.contract_amount),
    start_date: str(o.start_date),
    end_date: str(o.end_date),
    scope_of_out_work: str(o.scope_of_out_work),
    project_description: str(o.project_description),
    gc_address: str(o.gc_address),
    gc_office_phone: str(o.gc_office_phone),
    gc_fax: str(o.gc_fax),
    gc_job_number: str(o.gc_job_number),
    gc_pm: str(o.gc_pm),
    gc_superintendent: str(o.gc_superintendent) || base.gc_superintendent,
    gc_estimator: str(o.gc_estimator),
    gc_engineer: str(o.gc_engineer),
    owner_address: str(o.owner_address),
    owner_city_state_zip: str(o.owner_city_state_zip),
    owner_contact: str(o.owner_contact),
    owner_phone: str(o.owner_phone),
    architect_address: str(o.architect_address),
    architect_city_state_zip: str(o.architect_city_state_zip),
    architect_contact: str(o.architect_contact),
    architect_phone: str(o.architect_phone),
    drawings: str(o.drawings),
    icbi_estimator: str(o.icbi_estimator),
    icbi_pm: str(o.icbi_pm),
    icbi_engineer: str(o.icbi_engineer),
    icbi_foreman: str(o.icbi_foreman),
  };

  if (!info.job_city && !info.job_zip && project.job_address2?.trim()) {
    info.job_city = project.job_address2.trim();
  }

  return info;
}

export function jobCityZipCountyLine(info: JobInfoData): string {
  return [info.job_city.trim(), info.job_zip.trim(), info.job_county.trim()].filter(Boolean).join(", ");
}

export function gcAddressBlock(contractor: string, info: JobInfoData): string {
  return [contractor.trim(), info.gc_address.trim()].filter(Boolean).join("\n");
}

export function applyJobInfoToTransmittal(
  data: TransmittalData,
  contractor: string,
  info: JobInfoData,
): TransmittalData {
  const gcName = contractor.trim();
  const toBlock = [info.gc_pm.trim(), gcName, info.gc_address.trim()].filter(Boolean).join("\n");
  return {
    ...data,
    to_name: data.to_name.trim() || info.gc_pm.trim(),
    gc_name: data.gc_name.trim() || gcName,
    to_address: data.to_address.trim() || toBlock,
    to_phone: data.to_phone.trim() || info.gc_office_phone.trim(),
  };
}

export function parseProjectDataBlob(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}
