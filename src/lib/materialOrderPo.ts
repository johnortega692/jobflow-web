import { supabase } from "./supabase";

export type MaterialOrderPoScope = "wallcovering" | "frp" | "fwp";

function normalizeJobCode(jobNumber: string): string {
  const trimmed = jobNumber.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  return first || "JOB";
}

export type MaterialOrderPoRow = {
  id: string;
  projectId: string;
  jobNumber: string;
  jobName: string;
  poNumber: string;
  scope: MaterialOrderPoScope;
  vendorLabel: string;
  deliveryAddress: string;
  createdByName: string;
  receivedField: boolean;
  completed: boolean;
  createdAt: string;
};

type MaterialOrderPoDbRow = {
  id: string;
  project_id: string;
  job_number: string;
  job_name: string;
  po_number: string;
  scope: MaterialOrderPoScope;
  vendor_label: string;
  delivery_address: string;
  created_by_name: string;
  received_field: boolean;
  completed: boolean;
  created_at: string;
};

export async function previewNextMaterialOrderPo(jobNumber: string): Promise<string> {
  const code = normalizeJobCode(jobNumber);
  const { data, error } = await supabase.rpc("jobflow_preview_next_po_number" as never, {
    p_job_code: code,
  } as never);
  if (error) throw new Error(error.message);
  return String(data ?? "");
}

export async function allocateNextMaterialOrderPo(jobNumber: string): Promise<string> {
  const code = normalizeJobCode(jobNumber);
  const { data, error } = await supabase.rpc("field_tools_next_po_number" as never, {
    p_job_code: code,
  } as never);
  if (error) throw new Error(error.message);
  const po = String(data ?? "").trim();
  if (!po) throw new Error("Could not allocate PO number.");
  return po;
}

export async function ensureMaterialOrderPoSequencePast(
  jobNumber: string,
  poNumber: string,
): Promise<void> {
  const { error } = await supabase.rpc("jobflow_ensure_po_sequence_past" as never, {
    p_job_code: normalizeJobCode(jobNumber),
    p_po_number: poNumber.trim(),
  } as never);
  if (error) throw new Error(error.message);
}

/**
 * Resolve PO for a material order PDF: use override if provided, otherwise allocate next.
 */
export async function resolveMaterialOrderPo(input: {
  jobNumber: string;
  overridePo?: string;
}): Promise<string> {
  const override = input.overridePo?.trim() ?? "";
  if (override) {
    await ensureMaterialOrderPoSequencePast(input.jobNumber, override);
    return override;
  }
  return allocateNextMaterialOrderPo(input.jobNumber);
}

export async function recordMaterialOrderPo(input: {
  projectId: string;
  jobNumber: string;
  jobName: string;
  poNumber: string;
  scope: MaterialOrderPoScope;
  vendorLabel?: string;
  deliveryAddress?: string;
  createdBy?: string | null;
  createdByName?: string;
}): Promise<string> {
  const poNumber = input.poNumber.trim();
  if (!poNumber) throw new Error("PO number is required.");

  const { data: existing, error: existingErr } = await supabase
    .from("jobflow_material_order_pos" as never)
    .select("id")
    .eq("po_number" as never, poNumber)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  const existingId = (existing as { id?: string } | null)?.id;
  if (existingId) return String(existingId);

  const { data, error } = await supabase
    .from("jobflow_material_order_pos" as never)
    .insert({
      project_id: input.projectId,
      job_number: input.jobNumber.trim(),
      job_name: input.jobName.trim(),
      po_number: poNumber,
      scope: input.scope,
      vendor_label: input.vendorLabel?.trim() ?? "",
      delivery_address: input.deliveryAddress?.trim() ?? "",
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName?.trim() ?? "",
    } as never)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

export async function listMaterialOrderPosForJobs(
  jobNumbers: string[],
): Promise<MaterialOrderPoRow[]> {
  const codes = new Set(
    jobNumbers.map((n) => normalizeJobCode(n)).filter((c) => c && c !== "JOB"),
  );
  if (!codes.size) return [];

  const { data, error } = await supabase
    .from("jobflow_material_order_pos" as never)
    .select(
      "id, project_id, job_number, job_name, po_number, scope, vendor_label, delivery_address, created_by_name, received_field, completed, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as MaterialOrderPoDbRow[])
    .filter((row) => codes.has(normalizeJobCode(String(row.job_number ?? ""))))
    .map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      jobNumber: String(row.job_number ?? ""),
      jobName: String(row.job_name ?? ""),
      poNumber: String(row.po_number ?? ""),
      scope: row.scope,
      vendorLabel: String(row.vendor_label ?? ""),
      deliveryAddress: String(row.delivery_address ?? ""),
      createdByName: String(row.created_by_name ?? ""),
      receivedField: Boolean(row.received_field),
      completed: Boolean(row.completed),
      createdAt: String(row.created_at ?? ""),
    }));
}

export type MaterialOrderPoHistoryEntry = {
  poNumber: string;
  scope: MaterialOrderPoScope;
  vendorLabel: string;
  deliveryAddress: string;
  createdAt: string;
};

/** Unique POs for a project (newest first) — for regenerating order PDFs. */
export async function listMaterialOrderPoHistoryForProject(
  projectId: string,
): Promise<MaterialOrderPoHistoryEntry[]> {
  const id = projectId.trim();
  if (!id) return [];

  const { data, error } = await supabase
    .from("jobflow_material_order_pos" as never)
    .select("po_number, scope, vendor_label, delivery_address, created_at")
    .eq("project_id" as never, id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const out: MaterialOrderPoHistoryEntry[] = [];
  for (const row of (data ?? []) as Array<{
    po_number?: string;
    scope?: MaterialOrderPoScope;
    vendor_label?: string;
    delivery_address?: string;
    created_at?: string;
  }>) {
    const poNumber = String(row.po_number ?? "").trim();
    if (!poNumber || seen.has(poNumber)) continue;
    seen.add(poNumber);
    out.push({
      poNumber,
      scope: row.scope ?? "wallcovering",
      vendorLabel: String(row.vendor_label ?? "").trim(),
      deliveryAddress: String(row.delivery_address ?? "").trim(),
      createdAt: String(row.created_at ?? ""),
    });
  }
  return out;
}

export async function updateMaterialOrderPoTracking(
  id: string,
  patch: { receivedField?: boolean; completed?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {
    tracking_updated_at: new Date().toISOString(),
  };
  if (patch.receivedField !== undefined) body.received_field = patch.receivedField;
  if (patch.completed !== undefined) body.completed = patch.completed;

  const { error } = await supabase
    .from("jobflow_material_order_pos" as never)
    .update(body as never)
    .eq("id" as never, id);
  if (error) throw new Error(error.message);
}

export function materialOrderScopeLabel(scope: MaterialOrderPoScope): string {
  switch (scope) {
    case "wallcovering":
      return "Wallcovering";
    case "frp":
      return "FRP";
    case "fwp":
      return "FWP";
  }
}
