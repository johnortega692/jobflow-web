import { supabase } from "./supabase";

const BUCKET = "rfi-files";

const ACCEPTED_EXT = /\.(pdf|jpe?g|png)$/i;

export function isRfiAttachmentFile(file: File): boolean {
  return ACCEPTED_EXT.test(file.name);
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
}

export function rfiAttachmentStoragePath(
  projectId: string,
  rfiId: string,
  fileId: string,
  filename: string,
): string {
  return `${projectId}/${rfiId}/${fileId}_${safeFilename(filename)}`;
}

export async function uploadRfiAttachment(
  projectId: string,
  rfiId: string,
  fileId: string,
  file: File,
): Promise<{ path: string; filename: string }> {
  const path = rfiAttachmentStoragePath(projectId, rfiId, fileId, file.name);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return { path, filename: file.name };
}

export async function downloadRfiAttachment(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Could not download attachment.");
  return data.arrayBuffer();
}

export async function removeRfiAttachment(path: string): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function removeRfiAttachments(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(unique);
  if (error) throw new Error(error.message);
}
