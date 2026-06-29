export type FieldToolsOrderType = "field_request" | "job_scope_kit";

export type FieldToolsOrder = {
  id: string;
  job_number: string;
  job_name?: string;
  po_number?: string;
  order_type: FieldToolsOrderType;
  phase: string;
  submitted_by_name: string;
  submitted_by_email: string;
  crew_kit: string;
  crew_count: number;
  site_contact: string;
  notes: string;
  delivery_type: string;
  date_needed: string | null;
  scopes: unknown;
  materials: unknown;
  paint: unknown;
  payload: Record<string, unknown>;
  status: string;
  email_status?: string;
  created_at: string;
};
