import { loadOrgSettingsBlob, saveOrgSettingsPatch } from "./orgSettings";
import type { JobInfoData } from "../types/jobInfo";
import type { ProjectStaffSettings, StaffContact } from "../types/staffContacts";

export function emptyStaffContact(): StaffContact {
  return { id: crypto.randomUUID(), name: "", email: "" };
}

export function normalizeStaffContacts(raw: unknown): StaffContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const email = String(o.email ?? "").trim();
      if (!name && !email) return null;
      const id = String(o.id ?? "").trim() || crypto.randomUUID();
      return { id, name, email };
    })
    .filter((c): c is StaffContact => c !== null);
}

export function defaultProjectStaffSettings(): ProjectStaffSettings {
  return { project_staff_pms: [] };
}

export function normalizeProjectStaffSettings(raw: Record<string, unknown>): ProjectStaffSettings {
  return {
    project_staff_pms: normalizeStaffContacts(raw.project_staff_pms),
  };
}

export async function loadProjectStaffSettings(): Promise<ProjectStaffSettings> {
  const org = await loadOrgSettingsBlob();
  return normalizeProjectStaffSettings(org);
}

export async function saveProjectStaffSettings(
  settings: ProjectStaffSettings,
  userId: string,
): Promise<string | null> {
  return saveOrgSettingsPatch(
    {
      project_staff_pms: settings.project_staff_pms.filter((c) => c.name.trim() || c.email.trim()),
    },
    userId,
  );
}

export function staffContactLabel(contact: StaffContact): string {
  const name = contact.name.trim();
  const email = contact.email.trim();
  if (name && email) return `${name} (${email})`;
  return name || email;
}

/** Unique non-empty names from a project staff roster list. */
export function staffContactNames(contacts: StaffContact[]): string[] {
  return [...new Set(contacts.map((c) => c.name.trim()).filter(Boolean))];
}

export function findStaffContact(list: StaffContact[], id: string): StaffContact | undefined {
  if (!id) return undefined;
  return list.find((c) => c.id === id);
}

/** Apply roster selection to job info fields used across JobFlow. */
export function jobInfoPatchFromStaffSelection(
  superContact: StaffContact | undefined,
  foremanContact: StaffContact | undefined,
  pmContact?: StaffContact | undefined,
): Partial<JobInfoData> {
  const patch: Partial<JobInfoData> = {};
  if (superContact) {
    patch.staff_super_id = superContact.id;
    patch.field_request_super = superContact.name.trim();
    patch.icbi_super_email = superContact.email.trim();
  }
  if (foremanContact) {
    patch.staff_foreman_id = foremanContact.id;
    patch.icbi_foreman = foremanContact.name.trim();
    patch.icbi_foreman_email = foremanContact.email.trim();
  }
  if (pmContact) {
    patch.staff_pm_id = pmContact.id;
    patch.icbi_pm = pmContact.name.trim();
    patch.icbi_pm_email = pmContact.email.trim();
  }
  return patch;
}
