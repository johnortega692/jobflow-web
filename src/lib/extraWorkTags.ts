import { supabase } from "./supabase";

export type OfficeExtraWorkTag = {
  id: string;
  tagNumber: string;
  tagDate: string;
  area: string;
  description: string;
  hoursLabel: string;
  materialsLabel: string;
  submittedByName: string;
  status: string;
  signerName: string;
  signerCompany: string;
  signaturePng: string;
  refusedNote: string;
  photos: string[];
  hoursTotal: number;
  laborAmount: number | null;
  materialAmount: number | null;
  pdfPath: string;
  pdfFilename: string;
  updatedAt: string;
};

function positiveHours(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function hourRows(value: unknown): { name: string; hours: number; overtime: number; doubleTime: number; weekStart: string; days: { date: string; hours: number; overtime: number; doubleTime: number }[] }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const name = String(record.name ?? "").trim();
    const days = Array.isArray(record.days)
      ? record.days.flatMap((day) => {
          if (!day || typeof day !== "object") return [];
          const entry = day as Record<string, unknown>;
          const date = String(entry.date ?? "").slice(0, 10);
          const hours = positiveHours(entry.hours);
          const overtime = positiveHours(entry.overtime);
          const doubleTime = positiveHours(entry.double_time ?? entry.doubleTime);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (hours <= 0 && overtime <= 0 && doubleTime <= 0)) return [];
          return [{ date, hours, overtime, doubleTime }];
        })
      : [];
    const hours = days.length ? days.reduce((sum, day) => sum + day.hours, 0) : positiveHours(record.hours);
    const overtime = days.length ? days.reduce((sum, day) => sum + day.overtime, 0) : positiveHours(record.overtime);
    const doubleTime = days.length ? days.reduce((sum, day) => sum + day.doubleTime, 0) : positiveHours(record.double_time ?? record.doubleTime);
    const weekStart = String(record.week_start ?? record.weekStart ?? "").slice(0, 10);
    if (!name || (hours <= 0 && overtime <= 0 && doubleTime <= 0)) return [];
    return [{ name, hours, overtime, doubleTime, weekStart, days }];
  });
}

function dayBits(hours: number, overtime: number, doubleTime: number): string {
  const parts: string[] = [];
  if (hours > 0) parts.push(String(hours));
  if (overtime > 0) parts.push(`OT ${overtime}`);
  if (doubleTime > 0) parts.push(`DT ${doubleTime}`);
  return parts.join(" ");
}

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(year, month - 1, day);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[date.getDay()]} ${month}/${day}`;
}

function hoursLabel(value: unknown): string {
  return hourRows(value)
    .map((row) => {
      if (!row.days.length) return [row.name, dayBits(row.hours, row.overtime, row.doubleTime)].filter(Boolean).join(" ");
      const days = row.days.map((day) => `${shortDay(day.date)} ${dayBits(day.hours, day.overtime, day.doubleTime)}`.trim());
      const week = /^\d{4}-\d{2}-\d{2}$/.test(row.weekStart) ? `week of ${Number(row.weekStart.slice(5, 7))}/${Number(row.weekStart.slice(8, 10))}` : "";
      return `${row.name}${week ? ` ${week}` : ""}: ${days.join(", ")}`;
    })
    .join("; ");
}

function hoursTotal(value: unknown): number {
  return hourRows(value).reduce((sum, row) => sum + row.hours + row.overtime + row.doubleTime, 0);
}

function moneyAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function materialsLabel(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      const quantity = String(record.quantity ?? "").trim();
      const source = record.source === "paint" ? "Paint" : record.source === "sundry" ? "Sundries" : "";
      const category = String(record.category ?? "").trim();
      const kind = source && category ? `${source} · ${category}` : source;
      if (!name) return [];
      const label = kind ? `${kind} · ${name}` : name;
      return [quantity ? `${label} (${quantity})` : label];
    })
    .join(", ");
}

export async function loadExtraWorkTags(projectId: string): Promise<{
  tags: OfficeExtraWorkTag[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_extra_work_tags_for_jobflow" as never, {
    p_project_id: projectId,
  } as never);
  if (error) return { tags: [], error: error.message };
  const tags = (Array.isArray(data) ? data : []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      tagNumber: String(record.tag_number ?? ""),
      tagDate: String(record.tag_date ?? "").slice(0, 10),
      area: String(record.area ?? ""),
      description: String(record.description ?? ""),
      hoursLabel: hoursLabel(record.hours),
      materialsLabel: materialsLabel(record.materials),
      submittedByName: String(record.submitted_by_name ?? "").trim() || "Field user",
      status: String(record.status ?? "draft"),
      signerName: String(record.signer_name ?? "").trim(),
      signerCompany: String(record.signer_company ?? "").trim(),
      signaturePng: String(record.signature_png ?? ""),
      refusedNote: String(record.refused_note ?? "").trim(),
      hoursTotal: hoursTotal(record.hours),
      laborAmount: moneyAmount(record.labor_amount),
      materialAmount: moneyAmount(record.material_amount),
      pdfPath: String(record.pdf_storage_path ?? "").trim(),
      pdfFilename: String(record.pdf_filename ?? "").trim(),
      photos: Array.isArray(record.photos)
        ? record.photos.flatMap((photo) => {
            if (!photo || typeof photo !== "object") return [];
            const jpeg = String((photo as { image_jpeg?: unknown }).image_jpeg ?? "").trim();
            return jpeg ? [jpeg] : [];
          })
        : [],
      updatedAt: String(record.updated_at ?? ""),
    };
  });
  return { tags, error: null };
}

export async function allocateEwoNumber(projectId: string, paperNumbers: string[], fallback: (numbers: string[]) => string) {
  const { data, error } = await supabase.rpc("next_ewo_number" as never, {
    p_project_id: projectId,
  } as never);
  const payload = data as unknown;
  if (!error && typeof payload === "string" && payload.trim()) return payload.trim();
  return fallback(paperNumbers);
}

export async function saveExtraWorkTagPrice(
  id: string,
  labor: number,
  material: number,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("jobflow_set_extra_work_tag_price" as never, {
    p_id: id,
    p_labor: labor,
    p_material: material,
  } as never);
  if (error) return error.message;
  const payload = data as unknown as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) return payload?.error || "Could not save the price.";
  return null;
}

const EXTRA_WORK_PDF_BUCKET = "extra-work-tag-pdfs";

export async function openExtraWorkTagPdf(path: string, filename: string, download: boolean): Promise<void> {
  const { data, error } = await supabase.storage.from(EXTRA_WORK_PDF_BUCKET).createSignedUrl(
    path,
    60 * 10,
    download ? { download: filename || true } : undefined,
  );
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not open the PDF.");
  window.open(data.signedUrl, "_blank", "noopener");
}
