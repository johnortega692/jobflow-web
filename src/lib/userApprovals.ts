import { supabase } from "./supabase";

export type PendingUser = {
  userId: string;
  email: string;
  createdAt: string;
};

type PendingUserRow = {
  user_id: string;
  email: string | null;
  created_at: string | null;
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
