import { loadEffectiveUserSettings } from "./orgSettings";
import { parseProjectDataBlob } from "./jobInfo";
import { supabase } from "./supabase";
import type { Database, Json } from "../types/database";
import type { ProjectTradeData } from "../types/tradeDocuments";

export type ProjectActivityAction =
  | "project_created"
  | "project_data_saved"
  | "job_info_saved"
  | "startup_checklist_updated"
  | "paint_tracker_saved"
  | "wc_tracker_saved"
  | "field_start_date_updated"
  | "field_wc_install_date_updated"
  | "paint_submittal_saved"
  | "wallcovering_submittal_saved"
  | "frp_submittal_saved"
  | "track_submittal_saved"
  | "transmittal_saved"
  | "sds_packet_saved"
  | "budget_saved"
  | "submittal_log_added"
  | "submittal_log_updated"
  | "submittal_log_deleted"
  | "submittal_log_submitted"
  | "brushout_linked"
  | "rfi_created"
  | "rfi_saved"
  | "rfi_deleted"
  | "rfi_status_updated"
  | "work_order_created"
  | "work_order_saved"
  | "work_order_deleted"
  | "work_order_updated";

export type ProjectActivityRow = {
  id: string;
  project_id: string;
  user_id: string | null;
  user_name: string;
  action: ProjectActivityAction;
  summary: string;
  created_at: string;
};

export type ActivityUser = {
  userId: string | null;
  userName: string;
};

export async function resolveActivityUser(): Promise<ActivityUser> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? null;
  const email = authData.user?.email?.trim() ?? "";

  if (!userId) {
    return { userId: null, userName: "Field view" };
  }

  try {
    const settings = await loadEffectiveUserSettings(userId);
    const signer = typeof settings.signer_name === "string" ? settings.signer_name.trim() : "";
    const userName = typeof settings.user_name === "string" ? settings.user_name.trim() : "";
    const name = signer || userName;
    if (name) return { userId, userName: name };
  } catch {
    /* fall through */
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const displayName = profile?.display_name?.trim();
  if (displayName) return { userId, userName: displayName };

  return { userId, userName: email || "Unknown user" };
}

export async function recordProjectActivity(options: {
  projectId: string;
  action: ProjectActivityAction;
  summary: string;
  user?: ActivityUser;
}): Promise<string | null> {
  const actor = options.user ?? (await resolveActivityUser());
  const { error } = await supabase.from("project_activity").insert({
    project_id: options.projectId,
    user_id: actor.userId,
    user_name: actor.userName,
    action: options.action,
    summary: options.summary.trim() || options.action,
  });
  return error?.message ?? null;
}

export async function touchProjectUpdatedBy(
  projectId: string,
  userId: string | null,
): Promise<string | null> {
  const { error } = await supabase
    .from("projects")
    .update({ updated_by: userId })
    .eq("id", projectId);
  return error?.message ?? null;
}

/** Log activity and stamp projects.updated_by (for RFIs, work orders, submittal log rows, etc.). */
export async function logProjectActivityEvent(options: {
  projectId: string;
  action: ProjectActivityAction;
  summary: string;
  touchProject?: boolean;
  user?: ActivityUser;
}): Promise<string | null> {
  const actor = options.user ?? (await resolveActivityUser());
  if (options.touchProject !== false) {
    const touchErr = await touchProjectUpdatedBy(options.projectId, actor.userId);
    if (touchErr) return touchErr;
  }
  return recordProjectActivity({
    projectId: options.projectId,
    action: options.action,
    summary: options.summary,
    user: actor,
  });
}

const TRADE_DATA_ACTIVITY_PRIORITY: (keyof ProjectTradeData)[] = [
  "paint_submittal",
  "wallcovering_submittal",
  "frp_submittal",
  "track_submittal",
  "transmittal",
  "sds_packet",
  "budget_maker",
  "paint_submittal_history",
  "wallcovering_submittal_history",
  "paint_tracker",
  "wc_tracker_lines",
];

const TRADE_DATA_ACTIVITY: Record<
  keyof ProjectTradeData,
  { action: ProjectActivityAction; summary: string }
> = {
  paint_submittal: { action: "paint_submittal_saved", summary: "Paint submittal saved" },
  wallcovering_submittal: {
    action: "wallcovering_submittal_saved",
    summary: "Wallcovering submittal saved",
  },
  frp_submittal: { action: "frp_submittal_saved", summary: "FRP submittal saved" },
  track_submittal: { action: "track_submittal_saved", summary: "Track submittal saved" },
  transmittal: { action: "transmittal_saved", summary: "Transmittal saved" },
  sds_packet: { action: "sds_packet_saved", summary: "SDS packet saved" },
  budget_maker: { action: "budget_saved", summary: "Budget saved" },
  paint_submittal_history: {
    action: "paint_submittal_saved",
    summary: "Paint submittal history updated",
  },
  wallcovering_submittal_history: {
    action: "wallcovering_submittal_saved",
    summary: "Wallcovering submittal history updated",
  },
  paint_tracker: { action: "paint_tracker_saved", summary: "Paint tracker saved" },
  wc_tracker_lines: { action: "wc_tracker_saved", summary: "Wallcovering tracker saved" },
};

export function inferTradeDataActivity(
  prev: ProjectTradeData,
  next: ProjectTradeData,
): { action: ProjectActivityAction; summary: string } {
  for (const key of TRADE_DATA_ACTIVITY_PRIORITY) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      return TRADE_DATA_ACTIVITY[key];
    }
  }
  return { action: "project_data_saved", summary: "Project data saved" };
}

export type CommitProjectUpdateOptions = {
  projectId: string;
  activity: {
    action: ProjectActivityAction;
    summary: string;
  };
  /** Shallow-merge into existing projects.data */
  mergeData?: Record<string, unknown>;
  /** Top-level project columns (job_number, contractor, data as full replace, etc.) */
  columns?: Record<string, unknown>;
  user?: ActivityUser;
};

/** Load → merge → update project → log activity (shared-project audit trail). */
export async function commitProjectUpdate(options: CommitProjectUpdateOptions): Promise<string | null> {
  const { projectId, activity, mergeData, columns, user } = options;
  const actor = user ?? (await resolveActivityUser());

  const { data: row, error: loadErr } = await supabase
    .from("projects")
    .select("data")
    .eq("id", projectId)
    .single();
  if (loadErr) return loadErr.message;

  const base = parseProjectDataBlob(row?.data);
  const payload: Database["public"]["Tables"]["projects"]["Update"] = {
    updated_by: actor.userId,
    ...(columns as Database["public"]["Tables"]["projects"]["Update"]),
  };

  if (mergeData) {
    payload.data = { ...base, ...mergeData } as Json;
  } else if (columns?.data !== undefined) {
    payload.data = columns.data as Json;
  }

  const { error: updateErr } = await supabase.from("projects").update(payload).eq("id", projectId);
  if (updateErr) return updateErr.message;

  const logErr = await recordProjectActivity({
    projectId,
    action: activity.action,
    summary: activity.summary,
    user: actor,
  });
  return logErr;
}

export async function loadProjectActivity(
  projectId: string,
  limit = 12,
): Promise<{ rows: ProjectActivityRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("project_activity")
    .select("id, project_id, user_id, user_name, action, summary, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ProjectActivityRow[], error: null };
}

export function activityActionLabel(action: ProjectActivityAction): string {
  const labels: Record<ProjectActivityAction, string> = {
    project_created: "Project created",
    project_data_saved: "Project data",
    job_info_saved: "Job setup",
    startup_checklist_updated: "Startup checklist",
    paint_tracker_saved: "Paint tracker",
    wc_tracker_saved: "Wallcovering tracker",
    field_start_date_updated: "Field View — start date",
    field_wc_install_date_updated: "Field View — install date",
    paint_submittal_saved: "Paint submittal",
    wallcovering_submittal_saved: "Wallcovering submittal",
    frp_submittal_saved: "FRP submittal",
    track_submittal_saved: "Track submittal",
    transmittal_saved: "Transmittal",
    sds_packet_saved: "SDS packet",
    budget_saved: "Budget",
    submittal_log_added: "Submittal log",
    submittal_log_updated: "Submittal log",
    submittal_log_deleted: "Submittal log",
    submittal_log_submitted: "Submittal log",
    brushout_linked: "Brush-out link",
    rfi_created: "RFI",
    rfi_saved: "RFI",
    rfi_deleted: "RFI",
    rfi_status_updated: "RFI status",
    work_order_created: "Work order",
    work_order_saved: "Work order",
    work_order_deleted: "Work order",
    work_order_updated: "Work order",
  };
  return labels[action] ?? action;
}
