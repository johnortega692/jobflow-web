export type FieldToolsOrderType = "field_request" | "job_scope_kit" | "last_min" | "haul_off" | "pm_order";

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
  /** Set when the paper receipt was dropped off at the office instead of photographed. */
  paper_receipt_at?: string | null;
  paper_receipt_by?: string | null;
};
