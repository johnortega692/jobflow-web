import { commitProjectUpdate } from "./projectActivity";
import { patchUserSettings, loadRawUserSettings } from "./budgetLibrary";
import { supabase } from "./supabase";
import type { BrushoutPrepRecord } from "./paintUserSettings";
import {
  defaultPaintSubmittal,
  emptyPaintItem,
  parseProjectTradeData,
  type PaintItem,
} from "../types/tradeDocuments";

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createBrushoutPrepId(existing: BrushoutPrepRecord[]): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `BO-${today}-`;
  let seq = 1;
  for (const prep of existing) {
    if (prep.prep_id.startsWith(prefix)) {
      const n = parseInt(prep.prep_id.slice(prefix.length), 10);
      if (!Number.isNaN(n)) seq = Math.max(seq, n + 1);
    }
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function loadBrushoutPreps(userId: string): Promise<BrushoutPrepRecord[]> {
  const raw = await loadRawUserSettings(userId);
  return Array.isArray(raw.brushout_preps) ? (raw.brushout_preps as BrushoutPrepRecord[]) : [];
}

export async function saveBrushoutPreps(
  userId: string,
  preps: BrushoutPrepRecord[],
): Promise<string | null> {
  return patchUserSettings(userId, { brushout_preps: preps });
}

export function listBrushoutPrepsSorted(preps: BrushoutPrepRecord[]): BrushoutPrepRecord[] {
  return [...preps].sort((a, b) =>
    (b.last_modified ?? b.created ?? "").localeCompare(a.last_modified ?? a.created ?? ""),
  );
}

export function prepPaintItems(prep: BrushoutPrepRecord): PaintItem[] {
  return (prep.paint_items ?? []).map((item) => ({
    label: item.label ?? "",
    floor: item.floor ?? "",
    manufacturer: item.manufacturer ?? "",
    color: item.color ?? "",
    product: item.product ?? "",
    sheen: item.sheen ?? "",
    previous_color: item.previous_color ?? "",
  }));
}

export function paintItemHasContent(item: PaintItem): boolean {
  return Boolean(item.label.trim() || item.color.trim() || item.product.trim());
}

export type BrushoutPrepDraft = {
  prep_id: string | null;
  internal_reference: string;
  site_location: string;
  gc: string;
  paint_vendor: string;
  items: PaintItem[];
  status?: string;
  emailed_date?: string;
  linked_job_key?: string;
  linked_at?: string;
  created?: string;
};

export function buildPrepRecord(
  draft: BrushoutPrepDraft,
  existing: BrushoutPrepRecord | null,
  allPreps: BrushoutPrepRecord[],
): { record: BrushoutPrepRecord; error?: string } {
  if (!draft.site_location.trim() && !draft.internal_reference.trim()) {
    return { record: existing ?? { prep_id: "" }, error: "Enter a site/location or internal reference." };
  }
  const items = draft.items.filter(paintItemHasContent);
  if (!items.length) {
    return { record: existing ?? { prep_id: "" }, error: "Add at least one paint line before saving." };
  }

  const prepId = draft.prep_id ?? createBrushoutPrepId(allPreps);
  const stamp = nowStamp();
  const record: BrushoutPrepRecord = {
    prep_id: prepId,
    internal_reference: draft.internal_reference.trim(),
    site_location: draft.site_location.trim(),
    gc: draft.gc.trim(),
    paint_vendor: draft.paint_vendor.trim(),
    paint_items: items,
    line_count: items.length,
    status: existing?.status ?? draft.status ?? "open",
    emailed_date: existing?.emailed_date ?? draft.emailed_date,
    linked_job_key: existing?.linked_job_key ?? draft.linked_job_key,
    linked_at: existing?.linked_at ?? draft.linked_at,
    created: existing?.created ?? draft.created ?? stamp,
    last_modified: stamp,
  };
  return { record };
}

export function upsertPrepInList(preps: BrushoutPrepRecord[], record: BrushoutPrepRecord): BrushoutPrepRecord[] {
  const idx = preps.findIndex((p) => p.prep_id === record.prep_id);
  if (idx >= 0) {
    const next = [...preps];
    next[idx] = record;
    return next;
  }
  return [...preps, record];
}

export function markPrepEmailed(preps: BrushoutPrepRecord[], prepId: string): BrushoutPrepRecord[] {
  const stamp = nowStamp();
  return preps.map((p) =>
    p.prep_id === prepId
      ? {
          ...p,
          status: "brushouts_emailed",
          emailed_date: todayDate(),
          last_modified: stamp,
        }
      : p,
  );
}

export function markPrepLinked(
  preps: BrushoutPrepRecord[],
  prepId: string,
  projectId: string,
): BrushoutPrepRecord[] {
  const stamp = nowStamp();
  return preps.map((p) =>
    p.prep_id === prepId
      ? {
          ...p,
          status: "linked",
          linked_job_key: projectId,
          linked_at: stamp,
          last_modified: stamp,
        }
      : p,
  );
}

export async function linkBrushoutPrepToProject(
  projectId: string,
  prep: BrushoutPrepRecord,
  mergeMode: "replace" | "append",
): Promise<string | null> {
  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return error.message;

  const trade = parseProjectTradeData(data?.data);
  const current = trade.paint_submittal ?? defaultPaintSubmittal();
  const incoming = prepPaintItems(prep);
  const mapped = incoming.length ? incoming.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
  const items =
    mergeMode === "replace"
      ? mapped
      : [...current.items.filter(paintItemHasContent), ...mapped];

  const nextTrade = {
    ...trade,
    paint_submittal: {
      ...current,
      items: items.length ? items : [emptyPaintItem()],
      brushout_prep: {
        prep_id: prep.prep_id,
        site_location: prep.site_location,
        gc: prep.gc,
        internal_reference: prep.internal_reference,
        emailed_date: prep.emailed_date,
      },
    },
  };

  return commitProjectUpdate({
    projectId,
    mergeData: nextTrade,
    activity: {
      action: "brushout_linked",
      summary: `Brush-out prep ${prep.prep_id} linked to paint submittal (${mergeMode})`,
    },
  });
}
