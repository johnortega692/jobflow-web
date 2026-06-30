import { supabase } from "./supabase";

export type PendingUser = {
  userId: string;
  email: string;
  createdAt: string;
};

export type ApprovedUser = {
  userId: string;
  email: string;
  jobRole: string;
  approvedAt: string;
};

type PendingUserRow = {
  user_id: string;
  email: string | null;
  created_at: string | null;
};

type ApprovedUserRow = {
  user_id: string;
  email: string | null;
  job_role: string | null;
  approved_at: string | null;
};

export async function loadPendingUsers(): Promise<{ users: PendingUser[]; error: string | null }> {
  const { data, error } = await supabase.rpc("list_pending_users");
  if (error) return { users: [], error: error.message };
  const rows = (data ?? []) as PendingUserRow[];
  const users = rows.map((row) => ({
    userId: row.user_id,
    email: row.email ?? "",
    createdAt: row.created_at ?? "",
  }));
  return { users, error: null };
}

export async function approveUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc("approve_user", { target_user_id: userId } as never);
  return error?.message ?? null;
}

export async function rejectUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc("reject_user", { target_user_id: userId } as never);
  return error?.message ?? null;
}

export async function loadApprovedUsers(): Promise<{ users: ApprovedUser[]; error: string | null }> {
  const { data, error } = await supabase.rpc("list_approved_users");
  if (error) return { users: [], error: error.message };
  const rows = (data ?? []) as ApprovedUserRow[];
  const users = rows.map((row) => ({
    userId: row.user_id,
    email: row.email ?? "",
    jobRole: row.job_role ?? "",
    approvedAt: row.approved_at ?? "",
  }));
  return { users, error: null };
}

export async function setUserJobRole(userId: string, jobRole: string): Promise<string | null> {
  const { error } = await supabase.rpc("admin_set_user_job_role", {
    target_user_id: userId,
    p_job_role: jobRole,
  } as never);
  return error?.message ?? null;
}
