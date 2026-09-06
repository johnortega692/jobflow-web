/** Settings sidebar sections. adminOnly tabs stay admin-only; others can be granted per user. */

export const SETTINGS_TABS = [
  { id: "profile", label: "Profile & letterhead", menuGroup: "user" as const },
  { id: "email-signature", label: "Email signature", menuGroup: "user" as const },
  { id: "delivery", label: "Delivery" },
  { id: "users", label: "User approvals", adminOnly: true as const },
  { id: "completed-projects", label: "Completed projects", adminOnly: true as const },
  { id: "project-staff", label: "Project staff", adminOnly: true as const },
  { id: "vendors", label: "Vendors, architects & GCs" },
  { id: "google", label: "Mailing Settings", adminOnly: true as const },
  { id: "budget", label: "Budget", adminOnly: true as const },
  { id: "paint-catalog", label: "Paint products & sheens" },
  { id: "spec-sections", label: "Spec sections" },
  { id: "transmittal-categories", label: "Transmittal categories" },
  { id: "startup-checklist", label: "Startup checklist" },
  { id: "paint-vendors", label: "Paint vendors" },
  { id: "tracker-schedules", label: "Schedules" },
  { id: "work-orders", label: "Work orders" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsTabId = SettingsTab["id"];
export type SettingsMenuGroup = "user" | "admin";
export type GrantableSettingsTabId = Exclude<
  SettingsTabId,
  "profile" | "users" | "completed-projects" | "project-staff" | "google" | "budget"
>;

export const GRANTABLE_SETTINGS_TABS = SETTINGS_TABS.filter(
  (tab): tab is Extract<SettingsTab, { id: GrantableSettingsTabId }> =>
    !("adminOnly" in tab && tab.adminOnly) && tab.id !== "profile",
);

const GRANTABLE_ID_SET = new Set<string>(GRANTABLE_SETTINGS_TABS.map((tab) => tab.id));

export function isGrantableSettingsTabId(value: string): value is GrantableSettingsTabId {
  return GRANTABLE_ID_SET.has(value);
}

export function defaultGrantableSettingsTabIds(): GrantableSettingsTabId[] {
  return GRANTABLE_SETTINGS_TABS.map((tab) => tab.id);
}

/** Normalize a stored list. `null` means “not customized” (all grantable tabs). */
export function normalizeGrantableSettingsTabs(raw: unknown): GrantableSettingsTabId[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<GrantableSettingsTabId>();
  const out: GrantableSettingsTabId[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isGrantableSettingsTabId(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function effectiveGrantableSettingsTabs(
  raw: unknown,
): GrantableSettingsTabId[] {
  return normalizeGrantableSettingsTabs(raw) ?? defaultGrantableSettingsTabIds();
}

export function isSettingsTabVisible(
  tab: SettingsTab,
  isAdmin: boolean,
  grantedTabs: readonly string[] | null,
): boolean {
  if (isAdmin) return true;
  if ("adminOnly" in tab && tab.adminOnly) return false;
  if (tab.id === "profile") return true;
  const granted = grantedTabs ?? defaultGrantableSettingsTabIds();
  return granted.includes(tab.id);
}

export function settingsTabLabel(tabId: SettingsTabId): string {
  return SETTINGS_TABS.find((tab) => tab.id === tabId)?.label ?? "Settings";
}

export function settingsMenuGroup(tab: SettingsTab): SettingsMenuGroup {
  return "menuGroup" in tab && tab.menuGroup === "user" ? "user" : "admin";
}

export const SETTINGS_MENU_GROUP_META: Record<SettingsMenuGroup, { label: string; hint: string }> = {
  user: { label: "User", hint: "Each person can edit their own" },
  admin: { label: "Admin", hint: "Shared company settings" },
};
