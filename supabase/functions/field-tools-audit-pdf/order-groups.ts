export type AuditLineItem = {
  name: string;
  quantity?: string;
  detail?: string;
};

export type AuditItemGroup = {
  section: string;
  items: AuditLineItem[];
};

export type AuditOrder = {
  id: string;
  job_number: string;
  job_name?: string;
  po_number?: string;
  order_type: string;
  status: string;
  email_status?: string;
  submitted_by_name: string;
  site_contact?: string;
  notes?: string;
  delivery_type?: string;
  date_needed?: string | null;
  crew_kit?: string;
  crew_count?: number;
  payload: Record<string, unknown>;
  created_at: string;
};

import { formatDateNeeded } from "./dates.ts";

type PayloadLine = {
  name?: string;
  detail?: string;
  quantity?: string;
  raw?: string;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isPayloadLine(v: unknown): v is PayloadLine {
  return typeof v === "object" && v !== null && ("name" in v || "raw" in v);
}

function lineToItem(line: PayloadLine): AuditLineItem {
  return {
    name: line.name?.trim() || line.raw?.trim() || "—",
    detail: line.detail?.trim() || undefined,
    quantity: line.quantity?.trim() || undefined,
  };
}

function pushGroup(
  groups: AuditItemGroup[],
  lists: Record<string, unknown> | undefined,
  key: string,
  title: string,
  vendor?: string,
) {
  const arr = lists?.[key];
  if (!Array.isArray(arr) || !arr.length) return;
  const items = arr.filter(isPayloadLine).map(lineToItem);
  if (!items.length) return;
  groups.push({ section: key === "paint" && vendor ? `${title} · ${vendor}` : title, items });
}

export function orderTypeLabel(t: string): string {
  return t === "job_scope_kit" ? "Job Scope Kit" : "Field Request";
}

export function buildAuditItemGroups(order: AuditOrder): AuditItemGroup[] {
  const payload = order.payload ?? {};
  const lists = payload.lists as Record<string, unknown> | undefined;
  const sections = payload.sections as { haulOffActive?: boolean; haulOffNotes?: string } | undefined;
  const vendor = asString(payload.vendor);
  const groups: AuditItemGroup[] = [];

  pushGroup(groups, lists, "paint", "Paint", vendor);
  pushGroup(groups, lists, "sundries", "Sundries");
  pushGroup(groups, lists, "additional", "Additional");
  pushGroup(groups, lists, "rental", "Rental");
  pushGroup(groups, lists, "equipment", "Equipment");
  pushGroup(groups, lists, "wallcovering", "Wallcovering");

  if (sections?.haulOffActive) {
    groups.push({
      section: "Haul Off",
      items: [{ name: "Haul off request", detail: sections.haulOffNotes?.trim() || undefined, quantity: "1×" }],
    });
  }

  return groups;
}

export function buildAuditMetaLines(order: AuditOrder): string[] {
  const payload = order.payload ?? {};
  const lines: string[] = [];

  const siteContact = order.site_contact || asString(payload.name);
  if (siteContact) lines.push(`Site contact: ${siteContact}`);

  const dateNeeded = order.date_needed || asString(payload.date);
  if (dateNeeded) {
    const delivery = order.delivery_type || asString(payload.deliveryType);
    const deliveryLabel =
      delivery === "delivery" ? "Delivery" : delivery === "willCall" ? "Will call" : delivery;
    const formattedDate = formatDateNeeded(String(dateNeeded));
    lines.push(`Needed: ${formattedDate}${deliveryLabel ? ` · ${deliveryLabel}` : ""}`);
  }

  const vendor = asString(payload.vendor);
  if (vendor) lines.push(`Vendor: ${vendor}`);

  const pm = asString(payload.pm);
  const superName = asString(payload.super);
  if (pm || superName) lines.push(`PM / Super: ${[pm, superName].filter(Boolean).join("  |  ")}`);

  const foreman = asString(payload.foreman);
  if (foreman) lines.push(`Foreman: ${foreman}`);

  const crewKit = order.crew_kit || asString(payload.crewKit);
  const crewCount = order.crew_count || Number(payload.crewCount) || 0;
  if (crewKit) {
    lines.push(`Crew kit: ${crewCount > 0 ? `${crewKit} × ${crewCount}` : crewKit}`);
  }

  const notes = order.notes || asString(payload.notes);
  if (notes) lines.push(`Notes: ${notes}`);

  return lines;
}
