import type { AhaConsiderationKey } from "./considerations";

export type { AhaConsiderationKey };

export type AhaScope = "paint" | "wallcovering" | "access" | "general";

export type AhaStandard = "em385" | "calosha";

export type AhaStatus = "draft" | "submitted" | "accepted";

/** EM 385-1-1 probability: Frequent, Likely, Occasional, Seldom, Unlikely. */
export type AhaProb = "F" | "L" | "O" | "S" | "U";

/** EM 385-1-1 severity: Catastrophic, Critical, Marginal, Negligible. */
export type AhaSev = "C" | "R" | "M" | "N";

export type RacLevel = "E" | "H" | "M" | "L";

export type AhaStep = {
  id: string;
  name: string;
  hazards: string[];
  controls: string[];
  osha_refs: string;
  em385_refs: string;
  prob: AhaProb;
  sev: AhaSev;
};

/** Library templates store steps without an id. Ids are assigned when copied onto a job. */
export type AhaLibraryStep = Omit<AhaStep, "id"> & { id?: string };

export type AhaOptions = {
  matrix: boolean;
  /** Cal/OSHA "JHA modified and reviewed" signature table. */
  reviewLog: boolean;
  /** Print the regulation line under each step's controls. */
  show_refs: boolean;
  standard: AhaStandard;
};

export type AhaQualification = "competent" | "qualified" | "trained" | "qualified_licensed";

export type AhaEquipmentRow = {
  id: string;
  equipment: string;
  training: string;
  inspection: string;
};

export type AhaCompetentPerson = {
  id: string;
  activity: string;
  qualification: AhaQualification;
  na: boolean;
  note: string;
  /** Filled on a job AHA. Library rows keep this empty. */
  employee: string;
};

export type AhaReviewEntry = {
  id: string;
  name: string;
  date: string;
  note: string;
};

export type AhaLibraryItem = {
  id: string;
  slug: string;
  name: string;
  scope: AhaScope;
  csi: string;
  archived: boolean;
  considerations: AhaConsiderationKey[];
  equipment_rows: AhaEquipmentRow[];
  competent_persons: AhaCompetentPerson[];
  steps: AhaLibraryStep[];
  created_at: string;
  updated_at: string;
};

export type AhaProduct = {
  id: string;
  product: string;
  manufacturer: string;
  sds_on_file: boolean;
};

export type ProjectAha = {
  id: string;
  project_id: string;
  library_ids: string[];
  seq: number;
  name: string;
  scope: AhaScope;
  csi: string;
  status: AhaStatus;
  competent_person: string;
  considerations: AhaConsiderationKey[];
  equipment_rows: AhaEquipmentRow[];
  competent_persons: AhaCompetentPerson[];
  project_manager: string;
  superintendent: string;
  foreman: string;
  reviewed_by: string;
  notes: string;
  review_log: AhaReviewEntry[];
  products: AhaProduct[];
  extra_ppe: string[];
  steps: AhaStep[];
  options: AhaOptions;
  created_at: string;
  updated_at: string;
};

export type ProjectAhaPatch = Partial<
  Pick<
    ProjectAha,
    | "name"
    | "scope"
    | "csi"
    | "status"
    | "competent_person"
    | "considerations"
    | "equipment_rows"
    | "competent_persons"
    | "project_manager"
    | "superintendent"
    | "foreman"
    | "reviewed_by"
    | "notes"
    | "review_log"
    | "products"
    | "extra_ppe"
    | "steps"
    | "options"
    | "library_ids"
  >
>;
