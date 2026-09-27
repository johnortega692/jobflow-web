import { supabase } from "../supabase";

export type AhaEmergencyContact = {
  name: string;
  role: string;
  phone: string;
};

export type AhaEmergencyInfo = {
  site_address_override: string;
  nearest_hospital: string;
  occupational_clinic: string;
  emergency_contacts: AhaEmergencyContact[];
  muster_point: string;
};

export function emptyEmergency(): AhaEmergencyInfo {
  return {
    site_address_override: "",
    nearest_hospital: "",
    occupational_clinic: "",
    emergency_contacts: [],
    muster_point: "",
  };
}

function parseContacts(value: unknown): AhaEmergencyContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      name: typeof row.name === "string" ? row.name : "",
      role: typeof row.role === "string" ? row.role : "",
      phone: typeof row.phone === "string" ? row.phone : "",
    }));
}

export function emergencyComplete(info: AhaEmergencyInfo): boolean {
  const hospital = info.nearest_hospital.trim().length > 0;
  const contact = info.emergency_contacts.some((row) => row.name.trim() || row.phone.trim());
  return hospital && contact;
}

export async function loadProjectEmergency(projectId: string): Promise<AhaEmergencyInfo> {
  const { data, error } = await supabase
    .from("projects")
    .select("site_address_override, nearest_hospital, occupational_clinic, emergency_contacts, muster_point")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(error.message);
  return {
    site_address_override: data.site_address_override ?? "",
    nearest_hospital: data.nearest_hospital ?? "",
    occupational_clinic: data.occupational_clinic ?? "",
    emergency_contacts: parseContacts(data.emergency_contacts),
    muster_point: data.muster_point ?? "",
  };
}

export async function saveProjectEmergency(projectId: string, info: AhaEmergencyInfo): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({
      site_address_override: info.site_address_override.trim(),
      nearest_hospital: info.nearest_hospital.trim(),
      occupational_clinic: info.occupational_clinic.trim(),
      emergency_contacts: info.emergency_contacts.map((row) => ({
        name: row.name.trim(),
        role: row.role.trim(),
        phone: row.phone.trim(),
      })),
      muster_point: info.muster_point.trim(),
    })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
}
