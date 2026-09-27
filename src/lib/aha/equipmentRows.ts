import type { AhaCompetentPerson, AhaConsiderationKey, AhaEquipmentRow } from "./types";
import { orderConsiderations } from "./considerations";

/** Lowercase, trim, and drop one trailing "s" so "Ladders" matches "Ladder". */
export function normalizeEquipmentName(value: string): string {
  return value.trim().toLowerCase().replace(/s$/, "");
}

export function normalizeActivity(value: string): string {
  return value.trim().toLowerCase();
}

export function equipmentColumns(rows: AhaEquipmentRow[]): {
  equipment: string[];
  training: string[];
  inspection: string[];
} {
  return {
    equipment: rows.map((row) => row.equipment.trim()).filter(Boolean),
    training: rows.map((row) => row.training.trim()).filter(Boolean),
    inspection: rows.map((row) => row.inspection.trim()).filter(Boolean),
  };
}

/** Pair three lists by index. Items past the equipment list are stored as "General". */
export function equipmentRowsFromColumns(
  equipment: string[],
  training: string[],
  inspection: string[],
  existing: AhaEquipmentRow[] = [],
): AhaEquipmentRow[] {
  const eq = equipment.map((item) => item.trim()).filter(Boolean);
  const tr = training.map((item) => item.trim()).filter(Boolean);
  const ins = inspection.map((item) => item.trim()).filter(Boolean);
  const count = Math.max(eq.length, tr.length, ins.length);
  const rows: AhaEquipmentRow[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: existing[index]?.id ?? crypto.randomUUID(),
      equipment: index < eq.length ? eq[index]! : "General",
      training: tr[index] ?? "",
      inspection: ins[index] ?? "",
    });
  }
  return rows;
}

export function cloneEquipmentRows(rows: AhaEquipmentRow[]): AhaEquipmentRow[] {
  return rows.map((row) => ({ ...row, id: crypto.randomUUID() }));
}

export function mergeEquipmentRows(base: AhaEquipmentRow[], incoming: AhaEquipmentRow[]): AhaEquipmentRow[] {
  const rows = base.map((row) => ({ ...row }));
  for (const row of incoming) {
    const key = normalizeEquipmentName(row.equipment);
    const match = key ? rows.find((item) => normalizeEquipmentName(item.equipment) === key) : undefined;
    if (!match) {
      rows.push({ ...row, id: row.id || crypto.randomUUID() });
      continue;
    }
    if (!match.training.trim() && row.training.trim()) match.training = row.training.trim();
    if (!match.inspection.trim() && row.inspection.trim()) match.inspection = row.inspection.trim();
  }
  return rows;
}

export function mergeConsiderations(lists: readonly (readonly string[])[]): AhaConsiderationKey[] {
  return orderConsiderations(lists.flat());
}

export function cloneCompetentPersons(rows: AhaCompetentPerson[]): AhaCompetentPerson[] {
  return rows.map((row) => ({ ...row, id: crypto.randomUUID(), employee: "" }));
}

export function mergeCompetentPersons(
  base: AhaCompetentPerson[],
  incoming: AhaCompetentPerson[],
): AhaCompetentPerson[] {
  const rows = base.map((row) => ({ ...row }));
  for (const row of incoming) {
    const key = normalizeActivity(row.activity);
    if (!key) continue;
    const match = rows.find((item) => normalizeActivity(item.activity) === key);
    if (!match) {
      rows.push({ ...row, id: row.id || crypto.randomUUID(), employee: row.employee ?? "" });
      continue;
    }
    if (match.na && !row.na) match.na = false;
  }
  return rows;
}
