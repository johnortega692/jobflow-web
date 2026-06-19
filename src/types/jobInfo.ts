/** Job Info tab fields — aligned with desktop `collect_job_data()` → `job_info`. */

export type JobInfoData = {
  job_date: string;
  job_city: string;
  job_zip: string;
  job_county: string;
  job_type: string;
  job_cost_type: string;
  contract_amount: string;
  start_date: string;
  end_date: string;
  scope_of_out_work: string;
  project_description: string;
  gc_address: string;
  gc_office_phone: string;
  gc_fax: string;
  gc_job_number: string;
  gc_pm: string;
  gc_superintendent: string;
  gc_estimator: string;
  gc_engineer: string;
  owner_address: string;
  owner_city_state_zip: string;
  owner_contact: string;
  owner_phone: string;
  architect_address: string;
  architect_city_state_zip: string;
  architect_contact: string;
  architect_phone: string;
  drawings: string;
  icbi_estimator: string;
  icbi_pm: string;
  icbi_engineer: string;
  icbi_foreman: string;
};

export const JOB_TYPES = ["Commercial", "Residential"] as const;
export const JOB_COST_TYPES = ["Standard", "OCIP", "Cost Plus"] as const;

export function defaultJobInfo(): JobInfoData {
  return {
    job_date: "",
    job_city: "",
    job_zip: "",
    job_county: "",
    job_type: "Commercial",
    job_cost_type: "Standard",
    contract_amount: "",
    start_date: "",
    end_date: "",
    scope_of_out_work: "",
    project_description: "",
    gc_address: "",
    gc_office_phone: "",
    gc_fax: "",
    gc_job_number: "",
    gc_pm: "",
    gc_superintendent: "TBD",
    gc_estimator: "",
    gc_engineer: "",
    owner_address: "",
    owner_city_state_zip: "",
    owner_contact: "",
    owner_phone: "",
    architect_address: "",
    architect_city_state_zip: "",
    architect_contact: "",
    architect_phone: "",
    drawings: "",
    icbi_estimator: "",
    icbi_pm: "",
    icbi_engineer: "",
    icbi_foreman: "",
  };
}
