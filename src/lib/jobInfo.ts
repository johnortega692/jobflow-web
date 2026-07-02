import type { Project } from "../types/database";
import type { ProjectForm } from "../types/database";
import { defaultJobInfo, type JobInfoData } from "../types/jobInfo";
import {
  applyTransmittalContractNumber,
  mergeActiveTransmittalNumber,
} from "./transmittalPerContract";
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
    first_furnishing_date: str(o.first_furnishing_date),
    public_works: Boolean(o.public_works),
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
    icbi_pm_email: str(o.icbi_pm_email),
    icbi_engineer: str(o.icbi_engineer),
    icbi_foreman: str(o.icbi_foreman),
    icbi_foreman_email: str(o.icbi_foreman_email),
    icbi_super_email: str(o.icbi_super_email),
    field_request_pm: str(o.field_request_pm),
    field_request_super: str(o.field_request_super),
    staff_super_id: str(o.staff_super_id),
    staff_foreman_id: str(o.staff_foreman_id),
    staff_pm_id: str(o.staff_pm_id),
    has_wallcovering: Boolean(o.has_wallcovering),
    wc_job_number: str(o.wc_job_number),
    wc_job_name: str(o.wc_job_name),
    wc_contract_amount: str(o.wc_contract_amount),
    has_frp: Boolean(o.has_frp),
    frp_job_number: str(o.frp_job_number),
    frp_job_name: str(o.frp_job_name),
    frp_contract_amount: str(o.frp_contract_amount),
    has_track: Boolean(o.has_track),
    track_job_number: str(o.track_job_number),
    track_job_name: str(o.track_job_name),
    track_contract_amount: str(o.track_contract_amount),
  };

  if (!info.job_city && !info.job_zip && project.job_address2?.trim()) {
    info.job_city = project.job_address2.trim();
  }

  if (!info.icbi_pm.trim() && info.field_request_pm.trim()) {
    info.icbi_pm = info.field_request_pm.trim();
  }

  return info;
}

/** ICBI PM — Job setup → ICBI Info (Field Tools orders, field dashboard). */
export function icbiProjectManager(info: JobInfoData | undefined): string {
  if (!info) return "";
  return info.icbi_pm.trim() || info.field_request_pm.trim();
}

/** ICBI PM email for Field Tools order CC. */
export function icbiPmEmail(info: JobInfoData | undefined): string {
  return info?.icbi_pm_email?.trim() ?? "";
}

/** Copy ICBI fields into legacy field_request_* keys before persisting. */
export function syncLegacyFieldOrderFields(info: JobInfoData): JobInfoData {
  const pm = icbiProjectManager(info);
  const superName = icbiSuperintendent(info);
  return {
    ...info,
    icbi_pm: pm,
    field_request_pm: pm,
    field_request_super: superName,
  };
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

/** Per-project foreman notification CC (Job setup → ICBI foreman email). */
export function projectForemanEmail(info: JobInfoData | undefined): string {
  return info?.icbi_foreman_email?.trim() ?? "";
}

/** ICBI / Field Tools superintendent — not the GC's superintendent in GC Info. */
export function icbiSuperintendent(info: JobInfoData | undefined): string {
  return info?.field_request_super?.trim() ?? "";
}

export function icbiSuperEmail(info: JobInfoData | undefined): string {
  return info?.icbi_super_email?.trim() ?? "";
}

/** Unique ICBI super + foreman CC addresses across projects (digests, reminders). */
export function collectProjectIcbiStaffCc(projects: Pick<ProjectForm, "jobInfo">[]): string[] {
  const emails = new Set<string>();
  for (const project of projects) {
    const superEmail = icbiSuperEmail(project.jobInfo);
    const foremanEmail = projectForemanEmail(project.jobInfo);
    if (superEmail) emails.add(superEmail);
    if (foremanEmail) emails.add(foremanEmail);
  }
  return [...emails];
}

/** @deprecated Use collectProjectIcbiStaffCc */
export function collectProjectForemanCc(projects: Pick<ProjectForm, "jobInfo">[]): string[] {
  return collectProjectIcbiStaffCc(projects);
}

export type ProjectPaintNotificationRecipients = {
  primaryEmail: string;
  primaryName: string;
  cc: string[];
};

/** Paint tracker / vendor emails: PM from job setup, CC super + foreman on that job. */
export function resolveProjectPaintNotificationRecipients(
  project: Pick<ProjectForm, "jobInfo">,
  profileFallback?: { email?: string; name?: string },
): ProjectPaintNotificationRecipients | null {
  const primaryEmail = icbiPmEmail(project.jobInfo) || profileFallback?.email?.trim() || "";
  if (!primaryEmail) return null;
  const primaryName =
    icbiProjectManager(project.jobInfo) || profileFallback?.name?.trim() || "PM";
  return {
    primaryEmail,
    primaryName,
    cc: collectProjectIcbiStaffCc([project]),
  };
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

/** Manpower Cal job row label: `job_number job_name` (space-separated). */
export function manpowerJobDisplayName(jobNumber: string, jobName: string): string {
  return [jobNumber.trim(), jobName.trim()].filter(Boolean).join(" ").trim();
}

export type TradeJobIdentity = {
  contract: TransmittalContract;
  contractLabel: string;
  jobNumber: string;
  jobName: string;
  manpowerName: string;
};

function tradeIdentity(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  contract: TransmittalContract,
): TradeJobIdentity | null {
  const ids = transmittalPrintInfo(project, contract);
  const jobNumber = ids.job_number.trim();
  const jobName = ids.job_name.trim();
  if (!jobNumber && !jobName) return null;
  return {
    contract,
    contractLabel: TRANSMITTAL_CONTRACT_LABELS[contract],
    jobNumber,
    jobName,
    manpowerName: manpowerJobDisplayName(jobNumber, jobName),
  };
}

/** Distinct trade job identities for Field Tools, Manpower, and PO lookup (deduped by job #). */
export function projectTradeJobIdentities(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): TradeJobIdentity[] {
  const candidates: TradeJobIdentity[] = [];
  const paint = tradeIdentity(project, "paint");
  if (paint) candidates.push(paint);
  if (projectHasWallcovering(project.jobInfo)) {
    const wc = tradeIdentity(project, "wallcovering");
    if (wc) candidates.push(wc);
  }
  if (projectHasFrp(project.jobInfo)) {
    const frp = tradeIdentity(project, "frp");
    if (frp) candidates.push(frp);
  }
  if (projectHasTrack(project.jobInfo)) {
    const track = tradeIdentity(project, "track");
    if (track) candidates.push(track);
  }

  const seen = new Set<string>();
  const out: TradeJobIdentity[] = [];
  for (const item of candidates) {
    const key = item.jobNumber.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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
  const stored = mergeActiveTransmittalNumber(transmittal);
  return applyTransmittalContractNumber(stored, contract);
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

/** Contract amount for a trade (falls back to primary paint contract_amount). */
export function contractAmountForTrade(
  info: JobInfoData,
  contract: TransmittalContract,
): string {
  const primary = info.contract_amount.trim();
  switch (contract) {
    case "wallcovering":
      return info.wc_contract_amount.trim() || primary;
    case "frp":
      return info.frp_contract_amount.trim() || primary;
    case "track":
      return info.track_contract_amount.trim() || primary;
    default:
      return primary;
  }
}

/** Job name and contract amount for Budget Maker (from Dashboard / Job setup). */
export function budgetProfileValues(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  contract: TransmittalContract,
): { jobName: string; grandTotal: string } {
  const ids = transmittalPrintInfo(project, contract);
  return {
    jobName: ids.job_name || ids.job_number,
    grandTotal: contractAmountForTrade(project.jobInfo, contract),
  };
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

export function gcAddressBlock(_contractor: string, info: JobInfoData): string {
  return info.gc_address.trim();
}

export function applyJobInfoToTransmittal(
  data: TransmittalData,
  contractor: string,
  info: JobInfoData,
): TransmittalData {
  const gcName = contractor.trim();
  return {
    ...data,
    to_name: data.to_name.trim() || info.gc_pm.trim(),
    gc_name: data.gc_name.trim() || gcName,
    to_address: data.to_address.trim() || info.gc_address.trim(),
    to_phone: data.to_phone.trim() || info.gc_office_phone.trim(),
  };
}

export function parseProjectDataBlob(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}
