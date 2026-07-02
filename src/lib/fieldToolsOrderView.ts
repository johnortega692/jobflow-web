import type { FieldToolsOrder } from "../types/fieldToolsOrder";

export type OrderCartLine = {
  id: string;
  name: string;
  detail?: string;
  quantity: string;
};

export type OrderCartGroup = {
  section: string;
  items: OrderCartLine[];
};

type PayloadLine = {
  name?: string;
  detail?: string;
  quantity?: string;
  raw?: string;
};

type FieldRequestSections = {
  haulOffActive?: boolean;
  haulOffNotes?: string;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isPayloadLine(v: unknown): v is PayloadLine {
  return typeof v === "object" && v !== null && ("name" in v || "raw" in v);
}

function lineToCart(line: PayloadLine, id: string): OrderCartLine {
  return {
    id,
    name: line.name?.trim() || line.raw?.trim() || "—",
    detail: line.detail?.trim() || undefined,
    quantity: line.quantity?.trim() || "",
  };
}

function pushListGroup(
  groups: OrderCartGroup[],
  lists: Record<string, unknown> | undefined,
  key: string,
  title: string,
  vendor?: string,
) {
  const arr = lists?.[key];
  if (!Array.isArray(arr) || !arr.length) return;
  const items = arr.filter(isPayloadLine).map((line, i) => lineToCart(line, `${key}:${i}`));
  if (!items.length) return;
  const section =
    (key === "paint" || key === "sundries") && vendor ? `${title} · ${vendor}` : title;
  groups.push({ section, items });
}

export function orderTypeLabel(t: string): string {
  return t === "job_scope_kit" ? "Job Scope Kit" : "Field Request";
}

export function buildOrderDetailGroups(order: FieldToolsOrder): OrderCartGroup[] {
  const payload = order.payload ?? {};
  const lists = payload.lists as Record<string, unknown> | undefined;
  const sections = payload.sections as FieldRequestSections | undefined;
  const vendor = asString(payload.vendor);
  const sundriesVendor = asString(payload.sundriesVendor);
  const groups: OrderCartGroup[] = [];

  pushListGroup(groups, lists, "paint", "Paint", vendor);
  pushListGroup(
    groups,
    lists,
    "sundries",
    "Sundries",
    sundriesVendor && sundriesVendor !== vendor ? sundriesVendor : undefined,
  );
  pushListGroup(groups, lists, "additional", "Additional");
  pushListGroup(groups, lists, "rental", "Rental");
  pushListGroup(groups, lists, "equipment", "Equipment");
  pushListGroup(groups, lists, "wallcovering", "Wallcovering");

  if (sections?.haulOffActive) {
    groups.push({
      section: "Haul Off",
      items: [
        {
          id: "haulOff",
          name: "Haul off request",
          detail: sections.haulOffNotes?.trim() || undefined,
          quantity: "1×",
        },
      ],
    });
  }

  return groups;
}

export type OrderDetailRow = { label: string; value: string };

function formatDateNeeded(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function buildOrderDetailRows(order: FieldToolsOrder): OrderDetailRow[] {
  const payload = order.payload ?? {};
  const rows: OrderDetailRow[] = [];

  const siteContact = order.site_contact || asString(payload.name);
  if (siteContact) {
    const delivery = order.delivery_type || asString(payload.deliveryType);
    const label = delivery === "willCall" ? "Pick up person" : "Site contact";
    rows.push({ label, value: siteContact });
  }

  const dateNeeded = order.date_needed || asString(payload.date);
  if (dateNeeded) {
    const delivery = order.delivery_type || asString(payload.deliveryType);
    const deliveryLabel =
      delivery === "delivery" ? "Delivery" : delivery === "willCall" ? "Will call" : delivery;
    rows.push({
      label: "Needed",
      value: deliveryLabel ? `${formatDateNeeded(dateNeeded)} · ${deliveryLabel}` : formatDateNeeded(dateNeeded),
    });
  }

  const vendor = asString(payload.vendor);
  const sundriesVendor = asString(payload.sundriesVendor);
  if (vendor) rows.push({ label: "Paint vendor", value: vendor });
  if (sundriesVendor && sundriesVendor !== vendor) {
    rows.push({ label: "Sundries vendor", value: sundriesVendor });
  }

  const pm = asString(payload.pm);
  if (pm) rows.push({ label: "PM", value: pm });

  const superName = asString(payload.super);
  if (superName) rows.push({ label: "Super", value: superName });

  const foreman = asString(payload.foreman);
  if (foreman) rows.push({ label: "Foreman", value: foreman });

  const crewKit = order.crew_kit || asString(payload.crewKit);
  const crewCount = order.crew_count || Number(payload.crewCount) || 0;
  if (crewKit) {
    rows.push({
      label: "Crew kit",
      value: crewCount > 0 ? `${crewKit} × ${crewCount}` : crewKit,
    });
  }

  const notes = order.notes || asString(payload.notes);
  if (notes) rows.push({ label: "Notes", value: notes });

  return rows;
}

export function countCartGroups(groups: OrderCartGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}
