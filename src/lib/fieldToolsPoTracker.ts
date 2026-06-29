import { supabase } from "./supabase";

import type { FieldToolsOrder } from "../types/fieldToolsOrder";

export type FieldToolsPoDispatchRow = {
  dispatchId: string;
  poNumber: string;
  dispatchType: string;
  orderId: string;
  orderType: "field_request" | "job_scope_kit";
  jobNumber: string;
  jobName: string;
  contractLabel: string;
  submittedBy: string;
  dateNeeded: string | null;
  submittedAt: string;
  vendorLabel: string;
  emailStatus: string;
  receivedField: boolean;
  completed: boolean;
};

type DispatchRecord = {
  id: string;
  po_number: string;
  dispatch_type: string;
  to_email: string;
  email_status: string;
  created_at: string;
  received_field: boolean;
  completed: boolean;
  order: {
    id: string;
    job_number: string;
    job_name: string;
    order_type: "field_request" | "job_scope_kit";
    submitted_by_name: string;
    date_needed: string | null;
    created_at: string;
    payload: Record<string, unknown>;
  };
};

export function normalizeFieldToolsJobCode(jobNumber: string): string {
  const trimmed = jobNumber.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  return first || "JOB";
}

function vendorFromOrder(
  payload: Record<string, unknown>,
  dispatchType: string,
  poNumber: string,
  poNumbersOnOrder: string[],
): string {
  const paint = String(payload.vendor ?? "").trim();
  const sundries = String(payload.sundriesVendor ?? "").trim();
  const separate = Boolean(payload.separateSundriesVendor);

  if (separate && sundries && poNumbersOnOrder.length > 1) {
    const sundriesPo = poNumbersOnOrder[poNumbersOnOrder.length - 1];
    if (poNumber === sundriesPo) return sundries;
    return paint || sundries;
  }

  if (dispatchType === "job_scope_kit" || dispatchType === "material") {
    return paint || sundries;
  }

  return paint || String(payload.rentalVendor ?? "").trim() || "";
}

function dispatchTypeLabel(type: string): string {
  switch (type) {
    case "material":
      return "Material";
    case "job_scope_kit":
      return "Scope kit";
    default:
      return type.replace(/_/g, " ");
  }
}

function orderTypeLabel(type: string): string {
  return type === "job_scope_kit" ? "Job Scope Kit" : "Field Request";
}

export function formatPoOrderMeta(row: FieldToolsPoDispatchRow): string {
  return `${orderTypeLabel(row.orderType)} · ${dispatchTypeLabel(row.dispatchType)}`;
}

export async function listPoDispatchesForJob(jobNumber: string): Promise<FieldToolsPoDispatchRow[]> {
  return listPoDispatchesForJobs([{ jobNumber, contractLabel: "Paint" }]);
}

export type PoJobLookup = {
  jobNumber: string;
  contractLabel: string;
};

export async function listPoDispatchesForJobs(lookups: PoJobLookup[]): Promise<FieldToolsPoDispatchRow[]> {
  const labelByCode = new Map<string, string>();
  for (const lookup of lookups) {
    const code = normalizeFieldToolsJobCode(lookup.jobNumber);
    if (!code || code === "JOB") continue;
    if (!labelByCode.has(code)) labelByCode.set(code, lookup.contractLabel);
  }
  if (!labelByCode.size) return [];

  const jobCodes = new Set(labelByCode.keys());

  const { data, error } = await supabase
    .from("field_tools_order_dispatches")
    .select(
      `
      id,
      po_number,
      dispatch_type,
      to_email,
      email_status,
      created_at,
      received_field,
      completed,
      order:field_tools_orders!inner (
        id,
        job_number,
        job_name,
        order_type,
        submitted_by_name,
        date_needed,
        created_at,
        payload
      )
    `,
    )
    .neq("po_number", "")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as DispatchRecord[];
  const byOrder = new Map<string, string[]>();

  for (const row of rows) {
    if (!byOrder.has(row.order.id)) byOrder.set(row.order.id, []);
    byOrder.get(row.order.id)!.push(row.po_number);
  }

  return rows
    .filter((row) => jobCodes.has(normalizeFieldToolsJobCode(row.order.job_number)))
    .map((row) => {
      const payload =
        row.order.payload && typeof row.order.payload === "object" && !Array.isArray(row.order.payload)
          ? row.order.payload
          : {};
      const poNumbersOnOrder = byOrder.get(row.order.id) ?? [row.po_number];
      const jobCode = normalizeFieldToolsJobCode(row.order.job_number);

      return {
        dispatchId: row.id,
        poNumber: row.po_number,
        dispatchType: row.dispatch_type,
        orderId: row.order.id,
        orderType: row.order.order_type,
        jobNumber: row.order.job_number,
        jobName: row.order.job_name,
        contractLabel: labelByCode.get(jobCode) ?? "—",
        submittedBy: row.order.submitted_by_name,
        dateNeeded: row.order.date_needed,
        submittedAt: row.order.created_at,
        vendorLabel: vendorFromOrder(payload, row.dispatch_type, row.po_number, poNumbersOnOrder) || row.to_email,
        emailStatus: row.email_status,
        receivedField: row.received_field,
        completed: row.completed,
      };
    });
}

export async function getFieldToolsOrder(orderId: string): Promise<FieldToolsOrder | null> {
  const { data, error } = await supabase
    .from("field_tools_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};

  return {
    id: String(row.id),
    job_number: String(row.job_number ?? ""),
    job_name: String(row.job_name ?? ""),
    po_number: String(row.po_number ?? ""),
    order_type: row.order_type as FieldToolsOrder["order_type"],
    phase: String(row.phase ?? ""),
    submitted_by_name: String(row.submitted_by_name ?? ""),
    submitted_by_email: String(row.submitted_by_email ?? ""),
    crew_kit: String(row.crew_kit ?? ""),
    crew_count: Number(row.crew_count ?? 0),
    site_contact: String(row.site_contact ?? ""),
    notes: String(row.notes ?? ""),
    delivery_type: String(row.delivery_type ?? ""),
    date_needed: row.date_needed ? String(row.date_needed) : null,
    scopes: row.scopes,
    materials: row.materials,
    paint: row.paint,
    payload,
    status: String(row.status ?? ""),
    email_status: row.email_status ? String(row.email_status) : undefined,
    created_at: String(row.created_at ?? ""),
  };
}

export async function updatePoDispatchTracking(
  dispatchId: string,
  patch: { receivedField?: boolean; completed?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {
    tracking_updated_at: new Date().toISOString(),
  };
  if (patch.receivedField !== undefined) body.received_field = patch.receivedField;
  if (patch.completed !== undefined) body.completed = patch.completed;

  const { error } = await supabase
    .from("field_tools_order_dispatches")
    .update(body as never)
    .eq("id", dispatchId);
  if (error) throw new Error(error.message);
}
