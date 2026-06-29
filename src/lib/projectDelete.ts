import { parseWorkOrderData } from "../types/workOrder";
import { deleteWorkOrderSource } from "./workOrderStorage";
import { removeRfiAttachments } from "./rfiFileStorage";
import { supabase } from "./supabase";

export type CompletedProjectRow = {
  id: string;
  job_number: string;
  job_name: string;
  marked_done_at: string | null;
};

const SDS_BUCKET = "sds-files";
const RFI_BUCKET = "rfi-files";

function parseRfiAttachedFiles(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as { attached_files?: unknown }).attached_files;
  if (!Array.isArray(raw)) return [];
  const paths: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const path = (item as { storage_path?: string }).storage_path;
    if (typeof path === "string" && path) paths.push(path);
  }
  return paths;
}

async function listStoragePaths(bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(folder: string): Promise<void> {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 200 });
    if (error || !data?.length) return;
    for (const entry of data) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.id == null) {
        await walk(path);
      } else {
        paths.push(path);
      }
    }
  }

  await walk(prefix);
  return paths;
}

async function removeStoragePaths(bucket: string, paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return;
  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) {
      console.warn(`Storage cleanup (${bucket}):`, error.message);
    }
  }
}

async function cleanupProjectStorage(projectId: string): Promise<void> {
  const [workOrdersRes, rfisRes] = await Promise.all([
    supabase.from("work_orders").select("data").eq("project_id", projectId),
    supabase.from("rfis").select("data").eq("project_id", projectId),
  ]);

  const workOrderPaths =
    workOrdersRes.data?.map((row) => parseWorkOrderData(row.data).source_storage_path).filter(Boolean) ?? [];

  const rfiPaths = rfisRes.data?.flatMap((row) => parseRfiAttachedFiles(row.data)) ?? [];
  const [rfiPrefixPaths, sdsPrefixPaths] = await Promise.all([
    listStoragePaths(RFI_BUCKET, projectId),
    listStoragePaths(SDS_BUCKET, projectId),
  ]);

  await Promise.all([
    ...workOrderPaths.map((path) =>
      deleteWorkOrderSource(path).catch(() => {
        /* best-effort */
      }),
    ),
    removeRfiAttachments([...rfiPaths, ...rfiPrefixPaths]).catch(() => {
      /* best-effort */
    }),
    removeStoragePaths(SDS_BUCKET, sdsPrefixPaths),
  ]);
}

export async function listCompletedProjectsForAdmin(): Promise<{
  rows: CompletedProjectRow[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("admin_list_completed_projects" as never);
  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []) as CompletedProjectRow[];
  return { rows, error: null };
}

export async function deleteCompletedProject(projectId: string): Promise<string | null> {
  await cleanupProjectStorage(projectId);
  const { error } = await supabase.rpc(
    "admin_delete_completed_project" as never,
    { p_project_id: projectId } as never,
  );
  return error?.message ?? null;
}
