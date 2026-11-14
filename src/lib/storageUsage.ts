import { supabase } from "./supabase.js";

export type StorageBucketUsage = {
  bucket: string;
  files: number;
  bytes: number;
};

export type StorageLargestFile = {
  bucket: string;
  path: string;
  bytes: number;
  createdAt: string | null;
};

export type StorageUsage = {
  buckets: StorageBucketUsage[];
  largest: StorageLargestFile[];
  totalBytes: number;
  totalFiles: number;
};

const BUCKET_LABELS: Record<string, string> = {
  "sds-files": "SDS files",
  "field-tools-receipts": "Field receipts",
  "work-orders": "Work orders",
  "extra-work-tag-pdfs": "Extra work tags",
  letterhead: "Letterhead",
  "rental-calloff-photos": "Rental photos",
  "job-files": "Job files",
  "safety-record-pdfs": "Safety records",
  "rfi-files": "RFI files",
};

export function storageBucketLabel(bucket: string): string {
  return BUCKET_LABELS[bucket] ?? bucket.replace(/-/g, " ");
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function storageFileName(path: string): string {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Included uploaded-file storage on the Supabase Free plan. */
export const FILE_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asBuckets(value: unknown): StorageBucketUsage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as { bucket?: unknown; files?: unknown; bytes?: unknown };
      const bucket = typeof item.bucket === "string" ? item.bucket : "";
      if (!bucket) return null;
      return { bucket, files: asNumber(item.files), bytes: asNumber(item.bytes) };
    })
    .filter((row): row is StorageBucketUsage => row !== null);
}

function asLargest(value: unknown): StorageLargestFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as { bucket?: unknown; path?: unknown; bytes?: unknown; created_at?: unknown };
      const bucket = typeof item.bucket === "string" ? item.bucket : "";
      const path = typeof item.path === "string" ? item.path : "";
      if (!bucket || !path) return null;
      return {
        bucket,
        path,
        bytes: asNumber(item.bytes),
        createdAt: typeof item.created_at === "string" ? item.created_at : null,
      };
    })
    .filter((row): row is StorageLargestFile => row !== null);
}

export async function loadStorageUsage(): Promise<StorageUsage> {
  const { data, error } = await supabase.rpc("storage_usage" as never);
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as { buckets?: unknown; largest?: unknown };
  const buckets = asBuckets(payload.buckets);
  return {
    buckets,
    largest: asLargest(payload.largest),
    totalBytes: buckets.reduce((sum, row) => sum + row.bytes, 0),
    totalFiles: buckets.reduce((sum, row) => sum + row.files, 0),
  };
}
