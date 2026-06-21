import type { Project } from "../types/database";
import type { ProjectForm } from "../types/database";
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
    gc_pm_phone: str(o.gc_pm_phone),
    gc_pm_email: str(o.gc_pm_email),
    gc_superintendent: str(o.gc_superintendent) || base.gc_superintendent,
    gc_super_phone: str(o.gc_super_phone),
    gc_super_email: str(o.gc_super_email),
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
    field_request_pm: str(o.field_request_pm),
    field_request_super: str(o.field_request_super),
    has_wallcovering: Boolean(o.has_wallcovering),
    wc_job_number: str(o.wc_job_number),
    wc_job_name: str(o.wc_job_name),
    has_frp: Boolean(o.has_frp),
    frp_job_number: str(o.frp_job_number),
    frp_job_name: str(o.frp_job_name),
    has_track: Boolean(o.has_track),
    track_job_number: str(o.track_job_number),
    track_job_name: str(o.track_job_name),
  };

  if (!info.job_city && !info.job_zip && project.job_address2?.trim()) {
    info.job_city = project.job_address2.trim();
  }

  return info;
}

export function jobCityZipCountyLine(info: JobInfoData): string {
  return [info.job_city.trim(), info.job_zip.trim(), info.job_county.trim()].filter(Boolean).join(", ");
}

/** Street + city/zip/county (falls back to projects.job_address2). */
export function jobFullAddressLines(
  project: Pick<ProjectForm, "job_address" | "job_address2">,
  info: JobInfoData,
): string[] {
  const street = (project.job_address ?? "").trim();
  const cityLine = jobCityZipCountyLine(info) || (project.job_address2 ?? "").trim();
  return [street, cityLine].filter(Boolean);
}

export function jobFullAddressOneLine(
  project: Pick<ProjectForm, "job_address" | "job_address2">,
  info: JobInfoData,
): string {
  return jobFullAddressLines(project, info).join(", ");
}

export type ProjectPrintInfo = {
  job_number: string;
  job_name: string;
  job_address: string;
  job_address_line2: string;
};

export function projectPrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2">,
  info: JobInfoData,
): ProjectPrintInfo {
  const [street = "", cityLine = ""] = jobFullAddressLines(project, info);
  return {
    job_number: project.job_number,
    job_name: project.job_name,
    job_address: street,
    job_address_line2: cityLine,
  };
}

export function projectHasWallcovering(info: JobInfoData): boolean {
  return Boolean(info.has_wallcovering);
}

export type TransmittalContract = "paint" | "wallcovering" | "frp" | "track";

export const TRANSMITTAL_CONTRACT_LABELS: Record<TransmittalContract, string> = {
  paint: "Paint",
  wallcovering: "Wallcovering",
  frp: "FRP",
  track: "Track",
};

function tradeJobNumber(
  primary: string,
  override: string,
): string {
  return override.trim() || primary.trim();
}

export function wcTrackerJobNumber(project: Pick<ProjectForm, "job_number" | "jobInfo">): string {
  return tradeJobNumber(project.job_number, project.jobInfo.wc_job_number);
}

/** Job name used on the Wallcovering Tracker sheet. */
export function wcTrackerJobName(project: Pick<ProjectForm, "job_name" | "jobInfo">): string {
  return tradeJobNumber(project.job_name, project.jobInfo.wc_job_name);
}

export function frpJobNumber(project: Pick<ProjectForm, "job_number" | "jobInfo">): string {
  return tradeJobNumber(project.job_number, project.jobInfo.frp_job_number);
}

export function frpJobName(project: Pick<ProjectForm, "job_name" | "jobInfo">): string {
  return tradeJobNumber(project.job_name, project.jobInfo.frp_job_name);
}

export function trackJobNumber(project: Pick<ProjectForm, "job_number" | "jobInfo">): string {
  return tradeJobNumber(project.job_number, project.jobInfo.track_job_number);
}

export function trackJobName(project: Pick<ProjectForm, "job_name" | "jobInfo">): string {
  return tradeJobNumber(project.job_name, project.jobInfo.track_job_name);
}

export function projectHasFrp(info: JobInfoData): boolean {
  return Boolean(info.has_frp);
}

export function projectHasTrack(info: JobInfoData): boolean {
  return Boolean(info.has_track);
}

function tradeJobLabel(num: string, name: string): string {
  if (num && name) return `${num} · ${name}`;
  return num || name || "—";
}

export function frpJobLabel(project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">): string {
  return tradeJobLabel(frpJobNumber(project), frpJobName(project));
}

export function trackJobLabel(project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">): string {
  return tradeJobLabel(trackJobNumber(project), trackJobName(project));
}

export function paintTrackerJobLabel(project: Pick<ProjectForm, "job_number" | "job_name">): string {
  return tradeJobLabel(project.job_number.trim(), project.job_name.trim());
}

export function wcTrackerJobLabel(project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">): string {
  return tradeJobLabel(wcTrackerJobNumber(project), wcTrackerJobName(project));
}

function hasDistinctTradeContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  enabled: boolean,
  jobNumber: string,
  jobName: string,
): boolean {
  if (!enabled) return false;
  return jobNumber !== project.job_number.trim() || jobName !== project.job_name.trim();
}

/** True when WC job # or name differs from the primary paint contract. */
export function hasDistinctWcContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): boolean {
  return hasDistinctTradeContract(
    project,
    projectHasWallcovering(project.jobInfo),
    wcTrackerJobNumber(project),
    wcTrackerJobName(project),
  );
}

export function hasDistinctFrpContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): boolean {
  return hasDistinctTradeContract(
    project,
    projectHasFrp(project.jobInfo),
    frpJobNumber(project),
    frpJobName(project),
  );
}

export function hasDistinctTrackContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): boolean {
  return hasDistinctTradeContract(
    project,
    projectHasTrack(project.jobInfo),
    trackJobNumber(project),
    trackJobName(project),
  );
}

export function availableTransmittalContracts(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): TransmittalContract[] {
  const contracts: TransmittalContract[] = ["paint"];
  if (hasDistinctWcContract(project)) contracts.push("wallcovering");
  if (hasDistinctFrpContract(project)) contracts.push("frp");
  if (hasDistinctTrackContract(project)) contracts.push("track");
  return contracts;
}

export function hasTransmittalContractSwitch(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): boolean {
  return availableTransmittalContracts(project).length > 1;
}

export function coerceTransmittalContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  raw: unknown,
): TransmittalContract {
  const contract = normalizeTransmittalContract(raw);
  const available = availableTransmittalContracts(project);
  return available.includes(contract) ? contract : "paint";
}

export function applyTransmittalContractIfDistinct(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  transmittal: TransmittalData,
  contract: TransmittalContract,
): TransmittalData {
  if (!hasTransmittalContractSwitch(project)) return transmittal;
  if (!availableTransmittalContracts(project).includes(contract)) return transmittal;
  return { ...transmittal, contract };
}

function tradePrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2">,
  info: JobInfoData,
  num: string,
  name: string,
): ProjectPrintInfo {
  const base = projectPrintInfo(project, info);
  return { ...base, job_number: num, job_name: name };
}

/** Print header for wallcovering submittals and order forms (uses WC contract when set). */
export function wcPrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2">,
  info: JobInfoData,
): ProjectPrintInfo {
  return tradePrintInfo(
    project,
    info,
    wcTrackerJobNumber({ job_number: project.job_number, jobInfo: info }),
    wcTrackerJobName({ job_name: project.job_name, jobInfo: info }),
  );
}

export function frpPrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2">,
  info: JobInfoData,
): ProjectPrintInfo {
  return tradePrintInfo(
    project,
    info,
    frpJobNumber({ job_number: project.job_number, jobInfo: info }),
    frpJobName({ job_name: project.job_name, jobInfo: info }),
  );
}

export function trackPrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2">,
  info: JobInfoData,
): ProjectPrintInfo {
  return tradePrintInfo(
    project,
    info,
    trackJobNumber({ job_number: project.job_number, jobInfo: info }),
    trackJobName({ job_name: project.job_name, jobInfo: info }),
  );
}

export function transmittalPrintInfo(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  contract: TransmittalContract,
): Pick<ProjectPrintInfo, "job_number" | "job_name"> {
  switch (contract) {
    case "wallcovering":
      return { job_number: wcTrackerJobNumber(project), job_name: wcTrackerJobName(project) };
    case "frp":
      return { job_number: frpJobNumber(project), job_name: frpJobName(project) };
    case "track":
      return { job_number: trackJobNumber(project), job_name: trackJobName(project) };
    default:
      return { job_number: project.job_number.trim(), job_name: project.job_name.trim() };
  }
}

export function normalizeTransmittalContract(raw: unknown): TransmittalContract {
  if (raw === "wallcovering" || raw === "frp" || raw === "track") return raw;
  return "paint";
}

/** Full print header (address + contract job # / name) for PDFs and forms. */
export function projectPrintInfoForContract(
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2" | "jobInfo">,
  contract: TransmittalContract,
): ProjectPrintInfo {
  return {
    ...projectPrintInfo(project, project.jobInfo),
    ...transmittalPrintInfo(project, contract),
  };
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
