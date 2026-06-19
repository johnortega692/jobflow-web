import { loadRawUserSettings, patchUserSettings } from "./budgetLibrary";

export type DeliverySchedulingSettings = {
  default_delivery_address: string;
  warehouse_contact_name: string;
  warehouse_contact_email: string;
  warehouse_contact_cell: string;
  warehouse_main_office: string;
  receiving_hours: string;
  dock_restrictions: string;
  lift_gate_needed: string;
  closing_note: string;
};

export const DELIVERY_SETTINGS_KEYS = [
  "default_delivery_address",
  "warehouse_contact_name",
  "warehouse_contact_email",
  "warehouse_contact_cell",
  "warehouse_main_office",
  "receiving_hours",
  "dock_restrictions",
  "lift_gate_needed",
  "closing_note",
] as const satisfies readonly (keyof DeliverySchedulingSettings)[];

export const DEFAULT_DELIVERY_SCHEDULING: DeliverySchedulingSettings = {
  default_delivery_address: "5121 Port Chicago HWY Concord, CA 94520",
  warehouse_contact_name: "Anthony Zavaglia",
  warehouse_contact_email: "warehouse@creativeceilingsanddrywall.com",
  warehouse_contact_cell: "925-914-5955",
  warehouse_main_office: "925-826-5250",
  receiving_hours: "7:00AM-3:00PM, Monday-Friday",
  dock_restrictions:
    "Yes, please park on the street or back into the driveway. Call upon arrival.",
  lift_gate_needed: "No, We have a fork lift with extensions if needed.",
  closing_note:
    "We kindly request confirmation of this order and an update on the expected delivery timeline at your earliest convenience. Should you require any additional details, feel free to contact me directly.",
};

/** @deprecated Use default_delivery_address from settings */
export const WAREHOUSE_ADDRESS = DEFAULT_DELIVERY_SCHEDULING.default_delivery_address;

export function mergeDeliverySettings(raw: unknown): DeliverySchedulingSettings {
  const out = { ...DEFAULT_DELIVERY_SCHEDULING };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const key of DELIVERY_SETTINGS_KEYS) {
    const v = String(o[key] ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}

export async function loadDeliverySettings(userId: string): Promise<DeliverySchedulingSettings> {
  const raw = await loadRawUserSettings(userId);
  return mergeDeliverySettings(raw.delivery_scheduling);
}

export async function saveDeliverySettings(
  userId: string,
  settings: DeliverySchedulingSettings,
): Promise<string | null> {
  return patchUserSettings(userId, { delivery_scheduling: settings });
}
