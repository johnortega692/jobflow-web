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
  haulOffStartTime?: string;
  haulOffEndTime?: string;
  haulOffAccess?: string;
  haulOffGarageHeight?: string;
  haulOffHelpAvailable?: boolean | null;
  haulOffImageBase64?: string;
};

function formatHourLabel(hour24: string): string {
  const n = Number(hour24);
  if (!Number.isFinite(n)) return hour24;
  const hours = Math.floor(n);
  const minutes = Math.round((n - hours) * 60);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function haulOffDetail(sections: FieldRequestSections): string {
  const parts: string[] = [];
  const start = (sections.haulOffStartTime ?? "").trim();
  const end = (sections.haulOffEndTime ?? "").trim();
  if (start && end) parts.push(`${formatHourLabel(start)} – ${formatHourLabel(end)}`);
  if (sections.haulOffAccess === "street") parts.push("Street");
  if (sections.haulOffAccess === "garage") {
    const height = (sections.haulOffGarageHeight ?? "").trim();
    parts.push(height ? `Parking garage (${height})` : "Parking garage");
  }
  if (sections.haulOffHelpAvailable === true) parts.push("Help available: Yes");
  if (sections.haulOffHelpAvailable === false) parts.push("Help available: No");
  const notes = sections.haulOffNotes?.trim();
  if (notes) parts.push(notes);
  return parts.join(" · ");
}

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
  if (t === "job_scope_kit") return "Job Scope Kit";
  if (t === "last_min") return "Last-Min";
  if (t === "haul_off") return "Haul Out";
  return "Field Request";
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
      section: "Haul Out",
      items: [
        {
          id: "haulOff",
          name: "Haul out request",
          detail: haulOffDetail(sections) || undefined,
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
      delivery === "delivery" ? "Delivery" : delivery === "willCall" ? "Will call" : "";
    rows.push({
      label: "Needed",
      value: deliveryLabel ? `${formatDateNeeded(dateNeeded)} · ${deliveryLabel}` : formatDateNeeded(dateNeeded),
    });
  }

  const sections = (payload.sections as FieldRequestSections | undefined) ?? undefined;
  if (sections?.haulOffActive) {
    const start = (sections.haulOffStartTime ?? "").trim();
    const end = (sections.haulOffEndTime ?? "").trim();
    if (start && end) {
      rows.push({ label: "Time frame", value: `${formatHourLabel(start)} – ${formatHourLabel(end)}` });
    }
    if (sections.haulOffAccess === "street") rows.push({ label: "Location", value: "Street" });
    if (sections.haulOffAccess === "garage") {
      const height = (sections.haulOffGarageHeight ?? "").trim();
      rows.push({
        label: "Location",
        value: height ? `Parking garage (${height})` : "Parking garage",
      });
    }
    if (sections.haulOffHelpAvailable === true || sections.haulOffHelpAvailable === false) {
      rows.push({ label: "Help available", value: sections.haulOffHelpAvailable ? "Yes" : "No" });
    }
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

  const jobAddress = asString(payload.jobAddress) || asString(payload.deliveryAddress);
  if (jobAddress) rows.push({ label: "Address", value: jobAddress });

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

export function orderHaulOffPhotoSrc(order: FieldToolsOrder): string | null {
  const sections = order.payload?.sections as FieldRequestSections | undefined;
  const b = sections?.haulOffImageBase64?.trim() ?? "";
  if (!b) return null;
  if (b.startsWith("data:")) return b;
  return `data:image/jpeg;base64,${b}`;
}

export function countCartGroups(groups: OrderCartGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}
