import type { JobInfoData } from "../types/jobInfo";
import type { StaffContact } from "../types/staffContacts";
import type { UserProfile } from "../types/userProfile";
import { userJobRoleIsPm } from "../types/jobRoles";

export type IcbiPmOption = {
  key: string;
  name: string;
  email: string;
  label: string;
};

const PM_TITLE_RE = /\b(project\s*manager|project\s*mgmt|proj\.?\s*mgr)\b|\bpm\b/i;

/** True when Settings → Your profile job title looks like a project manager. */
export function userProfileTitleIsPm(profile: UserProfile): boolean {
  return PM_TITLE_RE.test(profile.title.trim());
}

export function findStaffContactByName(list: StaffContact[], name: string): StaffContact | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return list.find((c) => c.name.trim().toLowerCase() === needle);
}

export function userIsOnPmRoster(profile: UserProfile, roster: StaffContact[]): boolean {
  return Boolean(findStaffContactByName(roster, profile.name));
}

/** Default ICBI PM when admin-assigned job role is PM, title is PM, or name is on the PM roster. */
export function shouldDefaultPmFromProfile(
  profile: UserProfile,
  roster: StaffContact[],
  jobRole = "",
): boolean {
  if (!profile.name.trim()) return false;
  if (userJobRoleIsPm(jobRole)) return true;
  return userProfileTitleIsPm(profile) || userIsOnPmRoster(profile, roster);
}

export function resolvePmEmail(profile: UserProfile, roster: StaffContact[]): string {
  const fromProfile = profile.email.trim();
  if (fromProfile) return fromProfile;
  return findStaffContactByName(roster, profile.name)?.email.trim() ?? "";
}

/** PM dropdown: signed-in user first (when PM), then Settings → Project staff roster. */
export function buildIcbiPmOptions(
  profile: UserProfile,
  roster: StaffContact[],
  jobRole = "",
): IcbiPmOption[] {
  const seen = new Set<string>();
  const out: IcbiPmOption[] = [];

  const add = (name: string, email: string, label: string, key: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push({ key, name: trimmed, email: email.trim(), label });
  };

  if (shouldDefaultPmFromProfile(profile, roster, jobRole)) {
    add(profile.name, resolvePmEmail(profile, roster), `${profile.name.trim()} (you)`, "profile");
  }

  for (const contact of roster) {
    add(contact.name, contact.email, contact.name.trim(), contact.id);
  }

  return out;
}

export function jobInfoPatchFromProfilePm(
  profile: UserProfile,
  roster: StaffContact[],
  jobRole = "",
): Partial<JobInfoData> {
  if (!shouldDefaultPmFromProfile(profile, roster, jobRole)) return {};
  const rosterHit = findStaffContactByName(roster, profile.name);
  return {
    icbi_pm: profile.name.trim(),
    icbi_pm_email: resolvePmEmail(profile, roster),
    staff_pm_id: rosterHit?.id ?? "",
  };
}
