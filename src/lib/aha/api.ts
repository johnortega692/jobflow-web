import type { Json } from "../../types/database";
import { loadEffectiveUserSettings } from "../orgSettings";
import { supabase } from "../supabase";
import { orderConsiderations } from "./considerations";
import { mergedAhaScope, suggestedAhaName } from "./display";
import {
  cloneCompetentPersons,
  cloneEquipmentRows,
  mergeCompetentPersons,
  mergeConsiderations,
  mergeEquipmentRows,
} from "./equipmentRows";
import type {
  AhaCompetentPerson,
  AhaConsiderationKey,
  AhaEquipmentRow,
  AhaLibraryItem,
  AhaLibraryStep,
  AhaOptions,
  AhaProb,
  AhaProduct,
  AhaQualification,
  AhaReviewEntry,
  AhaScope,
  AhaSev,
  AhaStatus,
  AhaStep,
  ProjectAha,
  ProjectAhaPatch,
} from "./types";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

const SCOPES: readonly AhaScope[] = ["paint", "wallcovering", "access", "general"];
const STATUSES: readonly AhaStatus[] = ["draft", "submitted", "accepted"];
const PROBS: readonly AhaProb[] = ["F", "L", "O", "S", "U"];
const SEVS: readonly AhaSev[] = ["C", "R", "M", "N"];
const QUALIFICATIONS: readonly AhaQualification[] = ["competent", "qualified", "trained", "qualified_licensed"];

function asScope(value: string): AhaScope {
  if ((SCOPES as readonly string[]).includes(value)) return value as AhaScope;
  throw new Error(`Unexpected AHA scope "${value}".`);
}

function asStatus(value: string): AhaStatus {
  if ((STATUSES as readonly string[]).includes(value)) return value as AhaStatus;
  throw new Error(`Unexpected AHA status "${value}".`);
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: Json | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseLibraryStep(value: Json): AhaLibraryStep {
  if (!isRecord(value)) throw new Error("AHA step is not an object.");
  const prob = value.prob;
  const sev = value.sev;
  if (typeof prob !== "string" || !(PROBS as readonly string[]).includes(prob)) {
    throw new Error("AHA step has an invalid probability.");
  }
  if (typeof sev !== "string" || !(SEVS as readonly string[]).includes(sev)) {
    throw new Error("AHA step has an invalid severity.");
  }
  const step: AhaLibraryStep = {
    name: typeof value.name === "string" ? value.name : "",
    hazards: stringList(value.hazards),
    controls: stringList(value.controls),
    osha_refs: typeof value.osha_refs === "string" ? value.osha_refs : "",
    em385_refs: typeof value.em385_refs === "string" ? value.em385_refs : "",
    prob: prob as AhaProb,
    sev: sev as AhaSev,
  };
  if (typeof value.id === "string" && value.id) step.id = value.id;
  return step;
}

function parseLibrarySteps(value: Json): AhaLibraryStep[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseLibraryStep);
}

function parseProjectSteps(value: Json): AhaStep[] {
  return parseLibrarySteps(value).map((step) => {
    if (!step.id) throw new Error("Project AHA step is missing an id.");
    return { ...step, id: step.id };
  });
}

function assignStepIds(steps: AhaLibraryStep[]): AhaStep[] {
  return steps.map((step) => ({
    id: crypto.randomUUID(),
    name: step.name,
    hazards: [...step.hazards],
    controls: [...step.controls],
    osha_refs: step.osha_refs,
    em385_refs: step.em385_refs,
    prob: step.prob,
    sev: step.sev,
  }));
}

function parseConsiderations(value: Json): AhaConsiderationKey[] {
  return orderConsiderations(stringList(value));
}

function parseEquipmentRows(value: Json): AhaEquipmentRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
    equipment: typeof row.equipment === "string" ? row.equipment : "",
    training: typeof row.training === "string" ? row.training : "",
    inspection: typeof row.inspection === "string" ? row.inspection : "",
  }));
}

function parseCompetentPersons(value: Json): AhaCompetentPerson[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((row) => {
    const activity = typeof row.activity === "string" ? row.activity : "";
    if (!activity.trim()) return [];
    const qualification = row.qualification;
    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
        activity,
        qualification:
          typeof qualification === "string" && (QUALIFICATIONS as readonly string[]).includes(qualification)
            ? (qualification as AhaQualification)
            : "competent",
        na: row.na === true,
        note: typeof row.note === "string" ? row.note : "",
        employee: typeof row.employee === "string" ? row.employee : "",
      },
    ];
  });
}

function parseTextList(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseProducts(value: Json): AhaProduct[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
    product: typeof row.product === "string" ? row.product : "",
    manufacturer: typeof row.manufacturer === "string" ? row.manufacturer : "",
    sds_on_file: row.sds_on_file === true,
  }));
}

function parseReviewLog(value: Json): AhaReviewEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
    name: typeof row.name === "string" ? row.name : "",
    date: typeof row.date === "string" ? row.date : "",
    note: typeof row.note === "string" ? row.note : "",
  }));
}

function parseOptions(value: Json): AhaOptions {
  const standard = isRecord(value) && (value.standard === "calosha" || value.standard === "em385") ? value.standard : "em385";
  const showRefs = isRecord(value) && typeof value.show_refs === "boolean" ? value.show_refs : standard === "em385";
  if (!isRecord(value)) return { matrix: true, reviewLog: true, show_refs: showRefs, standard };
  return {
    matrix: value.matrix !== false,
    reviewLog: value.reviewLog !== false,
    show_refs: showRefs,
    standard,
  };
}

type LibraryRow = {
  id: string;
  slug: string;
  name: string;
  scope: string;
  csi: string;
  archived: boolean | null;
  considerations: Json;
  equipment_rows: Json;
  competent_persons: Json;
  steps: Json;
  created_at: string;
  updated_at: string;
};

function mapLibrary(row: LibraryRow): AhaLibraryItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    scope: asScope(row.scope),
    csi: row.csi ?? "",
    archived: Boolean(row.archived),
    considerations: parseConsiderations(row.considerations),
    equipment_rows: parseEquipmentRows(row.equipment_rows),
    competent_persons: parseCompetentPersons(row.competent_persons),
    steps: parseLibrarySteps(row.steps),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type ProjectRow = {
  id: string;
  project_id: string;
  library_ids: string[] | null;
  seq: number;
  name: string;
  scope: string;
  csi: string;
  status: string;
  competent_person: string;
  considerations: Json;
  equipment_rows: Json;
  competent_persons: Json;
  project_manager: string | null;
  superintendent: string | null;
  foreman: string | null;
  reviewed_by: string | null;
  notes: string | null;
  review_log: Json;
  products: Json;
  extra_ppe: string[] | null;
  steps: Json;
  options: Json;
  created_at: string;
  updated_at: string;
};

function mapProject(row: ProjectRow): ProjectAha {
  return {
    id: row.id,
    project_id: row.project_id,
    library_ids: (row.library_ids ?? []).filter((id) => typeof id === "string" && id),
    seq: row.seq,
    name: row.name,
    scope: asScope(row.scope),
    csi: row.csi ?? "",
    status: asStatus(row.status),
    competent_person: row.competent_person ?? "",
    considerations: parseConsiderations(row.considerations),
    equipment_rows: parseEquipmentRows(row.equipment_rows),
    competent_persons: parseCompetentPersons(row.competent_persons),
    project_manager: row.project_manager ?? "",
    superintendent: row.superintendent ?? "",
    foreman: row.foreman ?? "",
    reviewed_by: row.reviewed_by ?? "",
    notes: row.notes ?? "",
    review_log: parseReviewLog(row.review_log),
    products: parseProducts(row.products),
    extra_ppe: parseTextList(row.extra_ppe),
    steps: parseProjectSteps(row.steps),
    options: parseOptions(row.options),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listLibrary(): Promise<AhaLibraryItem[]> {
  const { data, error } = await supabase.from("aha_library").select("*").order("name");
  fail(error);
  return (data ?? []).map(mapLibrary);
}

export async function listProjectAhas(projectId: string): Promise<ProjectAha[]> {
  const { data, error } = await supabase
    .from("project_ahas")
    .select("*")
    .eq("project_id", projectId)
    .order("seq");
  fail(error);
  return (data ?? []).map(mapProject);
}

async function nextSeq(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_ahas")
    .select("seq")
    .eq("project_id", projectId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error);
  return (data?.seq ?? 0) + 1;
}

export async function createProjectAhaFromLibrary(
  projectId: string,
  input: { libraryIds: string[]; name: string; csi: string },
): Promise<ProjectAha> {
  const libraryIds = input.libraryIds.filter(Boolean);
  if (!libraryIds.length) throw new Error("Choose at least one library template.");

  const { data: rows, error: templateError } = await supabase
    .from("aha_library")
    .select("*")
    .in("id", libraryIds);
  fail(templateError);
  const byId = new Map((rows ?? []).map((row) => [row.id, mapLibrary(row)]));
  const templates: AhaLibraryItem[] = libraryIds.map((id) => {
    const template = byId.get(id);
    if (!template) throw new Error("AHA template was not found.");
    return template;
  });

  const steps = templates.flatMap((template) => assignStepIds(template.steps));
  const scopes = templates.map((template) => template.scope);
  const name = input.name.trim() || suggestedAhaName(scopes) || templates[0]!.name;
  const csi = input.csi.trim() || templates[0]!.csi;
  const considerations = mergeConsiderations(templates.map((template) => template.considerations));
  const equipmentRows = templates.reduce(
    (rows, template) => mergeEquipmentRows(rows, cloneEquipmentRows(template.equipment_rows)),
    [] as AhaEquipmentRow[],
  );
  const competentPersons = templates.reduce(
    (rows, template) => mergeCompetentPersons(rows, cloneCompetentPersons(template.competent_persons)),
    [] as AhaCompetentPerson[],
  );
  const projectManager = await currentUserFullName();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const seq = await nextSeq(projectId);
    const { data, error } = await supabase
      .from("project_ahas")
      .insert({
        project_id: projectId,
        library_ids: libraryIds,
        seq,
        name,
        scope: mergedAhaScope(scopes),
        csi,
        considerations,
        equipment_rows: equipmentRows,
        competent_persons: competentPersons,
        project_manager: projectManager,
        steps,
        options: { matrix: true, reviewLog: true, show_refs: false, standard: "calosha" },
      })
      .select("*")
      .single();
    if (!error && data) return mapProject(data);
    const unique = error?.code === "23505" || /duplicate|unique/i.test(error?.message ?? "");
    if (!unique || attempt === 2) throw new Error(error?.message ?? "Could not create the AHA.");
  }
  throw new Error("Could not assign the next AHA number.");
}

export async function updateProjectAha(id: string, patch: ProjectAhaPatch): Promise<ProjectAha> {
  const row: {
    name?: string;
    scope?: string;
    csi?: string;
    status?: string;
    competent_person?: string;
    considerations?: Json;
    equipment_rows?: Json;
    competent_persons?: Json;
    project_manager?: string;
    superintendent?: string;
    foreman?: string;
    reviewed_by?: string;
    notes?: string;
    review_log?: Json;
    products?: Json;
    extra_ppe?: string[];
    steps?: Json;
    options?: Json;
    library_ids?: string[];
  } = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.scope !== undefined) row.scope = patch.scope;
  if (patch.csi !== undefined) row.csi = patch.csi;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.competent_person !== undefined) row.competent_person = patch.competent_person;
  if (patch.considerations !== undefined) row.considerations = patch.considerations;
  if (patch.equipment_rows !== undefined) row.equipment_rows = patch.equipment_rows;
  if (patch.competent_persons !== undefined) row.competent_persons = patch.competent_persons;
  if (patch.project_manager !== undefined) row.project_manager = patch.project_manager;
  if (patch.superintendent !== undefined) row.superintendent = patch.superintendent;
  if (patch.foreman !== undefined) row.foreman = patch.foreman;
  if (patch.reviewed_by !== undefined) row.reviewed_by = patch.reviewed_by;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.review_log !== undefined) row.review_log = patch.review_log;
  if (patch.products !== undefined) {
    row.products = patch.products.map((item) => ({
      id: item.id || crypto.randomUUID(),
      product: item.product.trim(),
      manufacturer: item.manufacturer.trim(),
      sds_on_file: item.sds_on_file,
    }));
  }
  if (patch.extra_ppe !== undefined) row.extra_ppe = patch.extra_ppe.map((item) => item.trim()).filter(Boolean);
  if (patch.steps !== undefined) row.steps = patch.steps;
  if (patch.options !== undefined) row.options = patch.options;
  if (patch.library_ids !== undefined) row.library_ids = patch.library_ids;

  const { data, error } = await supabase.from("project_ahas").update(row).eq("id", id).select("*").single();
  fail(error);
  if (!data) throw new Error("AHA was not found.");
  return mapProject(data);
}

export async function deleteProjectAha(id: string): Promise<void> {
  const { error } = await supabase.from("project_ahas").delete().eq("id", id);
  fail(error);
}

export type LibraryTemplateInput = {
  name: string;
  scope: AhaScope;
  csi: string;
  equipment_rows: AhaEquipmentRow[];
  steps: AhaLibraryStep[];
};

function librarySlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "aha";
}

function cleanTextList(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function libraryStepsJson(steps: AhaLibraryStep[]): Json {
  return steps.map((step) => ({
    name: step.name.trim(),
    hazards: cleanTextList(step.hazards),
    controls: cleanTextList(step.controls),
    osha_refs: step.osha_refs.trim(),
    em385_refs: step.em385_refs.trim(),
    prob: step.prob,
    sev: step.sev,
  }));
}

function libraryWrite(input: LibraryTemplateInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name the template.");
  return {
    name,
    scope: input.scope,
    csi: input.csi.trim(),
    equipment_rows: input.equipment_rows.map((row) => ({
      id: row.id || crypto.randomUUID(),
      equipment: row.equipment.trim(),
      training: row.training.trim(),
      inspection: row.inspection.trim(),
    })),
    steps: libraryStepsJson(input.steps),
  };
}

export async function createLibraryTemplate(input: LibraryTemplateInput): Promise<AhaLibraryItem> {
  const row = libraryWrite(input);
  const base = librarySlug(row.name);
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data, error } = await supabase.from("aha_library").insert({ ...row, slug }).select("*").single();
    if (!error && data) return mapLibrary(data);
    if (error?.code !== "23505") fail(error);
  }
  throw new Error("Could not save a unique template name.");
}

export async function updateLibraryTemplate(id: string, input: LibraryTemplateInput): Promise<AhaLibraryItem> {
  const { data, error } = await supabase.from("aha_library").update(libraryWrite(input)).eq("id", id).select("*").single();
  fail(error);
  if (!data) throw new Error("AHA template was not found.");
  return mapLibrary(data);
}

async function currentUserFullName(): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return "";
  try {
    const settings = await loadEffectiveUserSettings(userId);
    const signer = typeof settings.signer_name === "string" ? settings.signer_name.trim() : "";
    if (signer) return signer;
  } catch {
    /* fall through to the profile row */
  }
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return profile?.display_name?.trim() ?? "";
}

export async function setLibraryArchived(ids: string[], archived: boolean): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("aha_library").update({ archived }).in("id", ids);
  fail(error);
}

export async function deleteLibraryTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("aha_library").delete().eq("id", id);
  fail(error);
}
