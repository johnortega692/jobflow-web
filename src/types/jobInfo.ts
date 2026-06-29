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
  gc_pm_phone: string;
  gc_pm_email: string;
  gc_superintendent: string;
  gc_super_phone: string;
  gc_super_email: string;
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
  /** Foreman email — CC on tracker notifications and vendor emails for this project */
  icbi_foreman_email: string;
  /** ICBI / Field Tools super email (from Field Tools profile on new project) */
  icbi_super_email: string;
  /** PM name for Field Tools / Manpower sync */
  field_request_pm: string;
  /** Super name for Field Tools / Manpower sync */
  field_request_super: string;
  /** Field Tools profile id (`field_tools_profiles.id`) for the project super */
  staff_super_id: string;
  /** Field Tools profile id (`field_tools_profiles.id`) for the project foreman */
  staff_foreman_id: string;
  /** Roster id from Settings → Project staff (office PMs) */
  staff_pm_id: string;
  /** Project includes a wallcovering contract / scope */
  has_wallcovering: boolean;
  /** Separate job number for Wallcovering Tracker (falls back to primary job #) */
  wc_job_number: string;
  /** Separate job name for Wallcovering Tracker (falls back to primary job name) */
  wc_job_name: string;
  /** Wallcovering contract amount (falls back to contract_amount) */
  wc_contract_amount: string;
  /** Project includes FRP scope / contract */
  has_frp: boolean;
  frp_job_number: string;
  frp_job_name: string;
  /** FRP contract amount (falls back to contract_amount) */
  frp_contract_amount: string;
  /** Project includes track scope / contract */
  has_track: boolean;
  track_job_number: string;
  track_job_name: string;
  /** Track contract amount (falls back to contract_amount) */
  track_contract_amount: string;
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
    gc_pm_phone: "",
    gc_pm_email: "",
    gc_superintendent: "TBD",
    gc_super_phone: "",
    gc_super_email: "",
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
    icbi_foreman_email: "",
    icbi_super_email: "",
    field_request_pm: "",
    field_request_super: "",
    staff_super_id: "",
    staff_foreman_id: "",
    staff_pm_id: "",
    has_wallcovering: false,
    wc_job_number: "",
    wc_job_name: "",
    wc_contract_amount: "",
    has_frp: false,
    frp_job_number: "",
    frp_job_name: "",
    frp_contract_amount: "",
    has_track: false,
    track_job_number: "",
    track_job_name: "",
    track_contract_amount: "",
  };
}
