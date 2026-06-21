import { supabase } from "./supabase";
import type { WorkOrderSourceMedia } from "../types/workOrder";
import { parseWorkOrderData } from "../types/workOrder";

const BUCKET = "work-orders";

function extensionForFile(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".gif")) return "gif";
  return "jpg";
}

export function workOrderStoragePath(userId: string, projectId: string, workOrderId: string, ext: string): string {
  return `${userId}/${projectId}/${workOrderId}/source.${ext}`;
}

export async function uploadWorkOrderSource(
  projectId: string,
  workOrderId: string,
  file: File,
): Promise<{ path: string; mediaType: WorkOrderSourceMedia }> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Sign in to upload work orders.");

  const ext = extensionForFile(file);
  const mediaType: WorkOrderSourceMedia = ext === "pdf" ? "pdf" : "image";
  const path = workOrderStoragePath(userData.user.id, projectId, workOrderId, ext);

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || (mediaType === "pdf" ? "application/pdf" : "image/jpeg"),
  });
  if (error) throw new Error(error.message);

  return { path, mediaType };
}

export async function downloadWorkOrderSource(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Could not load work order file.");
  return data.arrayBuffer();
}

export function mimeFromStoragePath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function deleteWorkOrderSource(path: string): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function deleteWorkOrder(workOrderId: string, data: unknown): Promise<void> {
  const form = parseWorkOrderData(data);
  if (form.source_storage_path) {
    try {
      await deleteWorkOrderSource(form.source_storage_path);
    } catch {
      // Best-effort cleanup; still remove the database row.
    }
  }

  const { error } = await supabase.from("work_orders").delete().eq("id", workOrderId);
  if (error) throw new Error(error.message);
}
