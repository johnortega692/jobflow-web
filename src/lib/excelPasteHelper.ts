import templateConfig from "../config/excelTemplateMappings.json";
import {
  contractAmountForTrade,
  jobFullAddressOneLine,
  normalizeTransmittalContract,
  transmittalPrintInfo,
  type TransmittalContract,
} from "./jobInfo";
import type { ProjectForm } from "../types/database";
import type { JobInfoData } from "../types/jobInfo";

export type ExcelTemplateMapping = {
  field: string;
  named_range: string;
  /** Desktop template editor "Merged" toggle — single-value paste into top-left cell. */
  merged?: boolean;
};

export type ExcelTemplateFile = {
  file: string;
  mappings: ExcelTemplateMapping[];
  rename_on_fill?: {
    enabled?: boolean;
    find?: string;
    replace_field?: string;
  };
};

export type ExcelPasteExtras = {
  signaturePrintName?: string;
  /** When set, job #, job name, and contract amount use this contract identity. */
  contract?: TransmittalContract;
};

export const EXCEL_FIELD_LABELS: Record<string, string> = {
  job_number: "Job #",
  job_name: "Job name",
  job_address: "Job address (full)",
  job_street_only: "Job address (street)",
  job_city: "City",
  job_zip: "Zip",
  job_county: "County / state",
  job_date: "Job date",
  job_type: "Job type",
  job_cost_type: "Cost type",
  contract_amount: "Contract amount",
  wc_contract_amount: "Wallcovering contract amount",
  frp_contract_amount: "FRP contract amount",
  track_contract_amount: "Track contract amount",
  start_date: "Start date",
  end_date: "End date",
  scope_of_out_work: "Scope of our work",
  project_description: "Project description",
  drawings: "Drawings",
  gc: "General contractor",
  gc_address: "GC address",
  gc_office_phone: "GC office phone",
  gc_fax: "GC fax",
  gc_job_number: "GC job #",
  gc_pm: "GC project manager",
  gc_superintendent: "GC superintendent",
  gc_estimator: "GC estimator",
  gc_engineer: "GC engineer",
  owner_name: "Owner name",
  owner_address: "Owner address",
  owner_city_state_zip: "Owner city / state / zip",
  owner_contact: "Owner contact",
  owner_phone: "Owner phone",
  architect: "Architect",
  architect_address: "Architect address",
  architect_city_state_zip: "Architect city / state / zip",
  architect_contact: "Architect contact",
  architect_phone: "Architect phone",
  icbi_estimator: "ICBI estimator",
  icbi_pm: "ICBI project manager",
  icbi_engineer: "ICBI engineer",
  icbi_foreman: "ICBI foreman",
  icbi_foreman_email: "ICBI foreman email",
  signature_print_name: "Printed signer name",
  req_bond: "Req: Bond",
  req_prevailing_wage: "Req: Prevailing wage",
  req_work_preservation: "Req: Work preservation",
  req_local_hire: "Req: Local hire",
  req_ocip: "Req: OCIP",
  req_work_comp: "Req: Work comp",
  req_gen_liab_excess: "Req: Gen liab excess",
};

export type ExcelPasteField = {
  key: string;
  label: string;
  value: string;
  cell: string;
  merged: boolean;
  singleCellPaste: boolean;
};

function topLeftCell(addr: string): string {
  return addr.split(":")[0]?.replace(/\$/g, "").toUpperCase() ?? addr.toUpperCase();
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Desktop Settings → Templates → Merged checkbox. */
export function mappingIsMerged(mapping: ExcelTemplateMapping): boolean {
  if (mapping.merged === true) return true;
  if (mapping.merged === false) return false;
  return mapping.named_range.includes(":");
}

/**
 * Desktop fill writes one value to top-left when Merged is on OR target is a range (D3:G3, H1:K1).
 */
export function mappingPastesAsSingleCell(mapping: ExcelTemplateMapping): boolean {
  if (mapping.merged === true) return true;
  if (mapping.merged === false && !mapping.named_range.includes(":")) return false;
  return mapping.named_range.includes(":");
}

export function dedupeExcelTemplates(files: ExcelTemplateFile[]): ExcelTemplateFile[] {
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = f.file.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const EXCEL_TEMPLATE_FILES = dedupeExcelTemplates(
  (templateConfig as { files: ExcelTemplateFile[] }).files,
);

export function resolveExcelFieldValue(
  fieldKey: string,
  project: ProjectForm,
  extras: ExcelPasteExtras = {},
): string {
  const j = project.jobInfo;
  const contract = normalizeTransmittalContract(extras.contract);

  switch (fieldKey) {
    case "job_number":
      return transmittalPrintInfo(project, contract).job_number;
    case "job_name":
      return transmittalPrintInfo(project, contract).job_name;
    case "contract_amount":
      return contractAmountForTrade(j, contract);
    case "job_address":
      return jobFullAddressOneLine(project, j);
    case "job_street_only":
      return project.job_address.trim();
    case "gc":
      return project.contractor.trim();
    case "architect":
      return project.architect.trim();
    case "owner_name":
      return project.owner.trim();
    case "signature_print_name":
      return extras.signaturePrintName?.trim() ?? "";
    default:
      break;
  }

  if (fieldKey in j) {
    return String(j[fieldKey as keyof JobInfoData] ?? "").trim();
  }

  return "";
}

export function templateDisplayName(filePath: string): string {
  return basename(filePath);
}

/** Match uploaded file to a known desktop template mapping. */
export function matchTemplateConfig(uploadedFileName: string): ExcelTemplateFile | null {
  const base = uploadedFileName.trim().toLowerCase();
  const exact = EXCEL_TEMPLATE_FILES.find(
    (t) => templateDisplayName(t.file).toLowerCase() === base,
  );
  if (exact) return exact;
  return (
    EXCEL_TEMPLATE_FILES.find((t) => {
      const name = templateDisplayName(t.file).toLowerCase();
      return base.includes(name) || name.includes(base.replace(/\.(xlsx|xlsm|xls)$/, ""));
    }) ?? null
  );
}

export function buildTemplateFieldPreview(
  mappings: ExcelTemplateMapping[],
  project: ProjectForm,
  extras: ExcelPasteExtras = {},
): ExcelPasteField[] {
  return mappings.map((m) => {
    const cell = topLeftCell(m.named_range);
    return {
      key: m.field,
      label: EXCEL_FIELD_LABELS[m.field] ?? m.field,
      value: resolveExcelFieldValue(m.field, project, extras),
      cell,
      merged: mappingIsMerged(m),
      singleCellPaste: mappingPastesAsSingleCell(m),
    };
  });
}
