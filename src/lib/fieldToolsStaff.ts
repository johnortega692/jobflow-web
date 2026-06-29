import { supabase } from "./supabase";
import type { StaffContact } from "../types/staffContacts";

export type FieldToolsStaffRole = "super" | "foreman";

export type FieldToolsStaffLists = {
  supers: StaffContact[];
  foremen: StaffContact[];
};

function mapRow(row: {
  id: string;
  name: string;
  email: string;
  role: string;
}): StaffContact | null {
  const name = row.name.trim();
  if (!name) return null;
  return {
    id: row.id,
    name,
    email: row.email.trim(),
  };
}

export type FieldToolsStaffRow = {
  id: string;
  person_id: string | null;
  name: string;
  email: string;
  role: string;
};

export async function loadFieldToolsStaffForJobflow(): Promise<{
  lists: FieldToolsStaffLists;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_field_tools_staff_for_jobflow");
  if (error) {
    return {
      lists: { supers: [], foremen: [] },
      error: error.message,
    };
  }

  const supers: StaffContact[] = [];
  const foremen: StaffContact[] = [];
  const rows = (data ?? []) as FieldToolsStaffRow[];
  for (const row of rows) {
    const contact = mapRow(row);
    if (!contact) continue;
    if (row.role === "super") supers.push(contact);
    else if (row.role === "foreman") foremen.push(contact);
  }

  return { lists: { supers, foremen }, error: null };
}
