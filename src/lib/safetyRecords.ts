import { supabase } from "./supabase";

export type InspectionItem = {
  section: string;
  name: string;
  status: string;
  notes: string;
  party: string;
};

export type SafetyInspectionRecord = {
  id: string;
  weekEnding: string;
  inspectorName: string;
  inspectionDate: string;
  submittedByName: string;
  completedAt: string;
  otherConcerns: string;
  accidentAttached: boolean;
  okCount: number;
  attentionCount: number;
  naCount: number;
  items: InspectionItem[];
  status: "saved" | "submitted";
  updatedAt: string;
};

export type ManpowerEntry = {
  trade: string;
  foremen: number;
  journeymen: number;
  apprentices: number;
  laborers: number;
  hours: number;
};

export type FieldReportRecord = {
  id: string;
  reportDate: string;
  superintendent: string;
  contractor: string;
  location: string;
  weather: { conditions: string; temp: string; wind: string; precipitation: string };
  manpower: ManpowerEntry[];
  materials: string;
  workPerformed: string;
  delays: string[];
  delayNotes: string;
  toolboxTalk: string;
  incidents: string;
  ppeHousekeeping: string;
  safetyNotes: string;
  reportedBy: string;
  reporterTitle: string;
  signDate: string;
  photos: { caption: string }[];
  submittedByName: string;
  completedAt: string;
  status: "saved" | "submitted";
  updatedAt: string;
};

type InspectionRow = {
  id: string;
  week_ending: string;
  inspector_name: string;
  inspection_date: string | null;
  submitted_by_name: string;
  completed_at: string;
  other_concerns: string;
  accident_attached: boolean;
  ok_count: number;
  attention_count: number;
  na_count: number;
  items: InspectionItem[] | null;
  status: string | null;
  updated_at: string | null;
};

type ReportRow = {
  id: string;
  report_date: string;
  superintendent: string;
  contractor: string;
  location: string;
  weather: FieldReportRecord["weather"] | null;
  manpower: ManpowerEntry[] | null;
  materials: string;
  work_performed: string;
  delays: string[] | null;
  delay_notes: string;
  toolbox_talk: string;
  incidents: string;
  ppe_housekeeping: string;
  safety_notes: string;
  reported_by: string;
  reporter_title: string;
  sign_date: string | null;
  photos: { caption?: string; image_jpeg?: string }[] | null;
  submitted_by_name: string;
  completed_at: string;
  status: string | null;
  updated_at: string | null;
};

function recordStatus(value: string | null | undefined): "saved" | "submitted" {
  return value === "saved" ? "saved" : "submitted";
}

export async function loadSafetyInspections(projectId: string): Promise<{
  records: SafetyInspectionRecord[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_safety_inspections_for_jobflow" as never, {
    p_project_id: projectId,
  } as never);
  if (error) return { records: [], error: error.message };
  const records = ((data ?? []) as InspectionRow[]).map((row) => ({
    id: row.id,
    weekEnding: row.week_ending,
    inspectorName: row.inspector_name.trim(),
    inspectionDate: row.inspection_date ?? "",
    submittedByName: row.submitted_by_name.trim() || "Field user",
    completedAt: row.completed_at,
    otherConcerns: row.other_concerns.trim(),
    accidentAttached: row.accident_attached,
    okCount: row.ok_count,
    attentionCount: row.attention_count,
    naCount: row.na_count,
    items: Array.isArray(row.items) ? row.items : [],
    status: recordStatus(row.status),
    updatedAt: row.updated_at || row.completed_at,
  }));
  return { records, error: null };
}

export async function loadFieldReports(projectId: string): Promise<{
  records: FieldReportRecord[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_field_reports_for_jobflow" as never, {
    p_project_id: projectId,
  } as never);
  if (error) return { records: [], error: error.message };
  const records = ((data ?? []) as ReportRow[]).map((row) => ({
    id: row.id,
    reportDate: row.report_date,
    superintendent: row.superintendent.trim(),
    contractor: row.contractor.trim(),
    location: row.location.trim(),
    weather: {
      conditions: row.weather?.conditions ?? "",
      temp: row.weather?.temp ?? "",
      wind: row.weather?.wind ?? "",
      precipitation: row.weather?.precipitation ?? "",
    },
    manpower: Array.isArray(row.manpower) ? row.manpower : [],
    materials: row.materials.trim(),
    workPerformed: row.work_performed.trim(),
    delays: row.delays ?? [],
    delayNotes: row.delay_notes.trim(),
    toolboxTalk: row.toolbox_talk.trim(),
    incidents: row.incidents.trim(),
    ppeHousekeeping: row.ppe_housekeeping.trim(),
    safetyNotes: row.safety_notes.trim(),
    reportedBy: row.reported_by.trim(),
    reporterTitle: row.reporter_title.trim(),
    signDate: row.sign_date ?? "",
    photos: [],
    submittedByName: row.submitted_by_name.trim() || "Field user",
    completedAt: row.completed_at,
    status: recordStatus(row.status),
    updatedAt: row.updated_at || row.completed_at,
  }));
  return { records, error: null };
}

export function formatRecordDay(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function yesNoLabel(value: string): string {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "na") return "N/A";
  return "—";
}
