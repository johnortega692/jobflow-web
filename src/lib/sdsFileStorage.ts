import { supabase } from "./supabase";
import { sanitizeFinishType, type SdsAttachmentKind } from "./sdsSectionModel";

const BUCKET = "sds-files";

export async function uploadSdsPdf(
  projectId: string,
  sectionId: string,
  kind: SdsAttachmentKind,
  file: File,
): Promise<{ path: string; filename: string }> {
  const path = `${projectId}/${sectionId}/${kind}.pdf`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) throw new Error(error.message);

  return { path, filename: file.name };
}

export async function downloadSdsPdf(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Could not download PDF.");
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeSdsPdf(path: string): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

/** Parse "Manufacturer - Product - Finish.pdf" style names (attachment suffixes stripped from finish). */
export function parseSdsFilename(name: string): Partial<{
  manufacturer: string;
  product: string;
  finish_type: string;
}> {
  const stem = name.replace(/\.pdf$/i, "").trim();
  const parts = stem.split(/\s*[-_|]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      manufacturer: parts[0],
      product: parts[1],
      finish_type: sanitizeFinishType(parts.slice(2).join(" - ")),
    };
  }
  if (parts.length === 2) {
    return { manufacturer: parts[0], product: parts[1] };
  }
  if (parts.length === 1) {
    return { product: parts[0] };
  }
  return {};
}
