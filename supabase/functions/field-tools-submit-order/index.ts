import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { embedLogoUrlInHtml, loadOrderBranding } from "./branding.ts";
import { formatOrderDateTime } from "./dates.ts";
import {
  buildOrderEmailHtml,
  formatJobProjectLabel,
  formatOrderedBy,
  lineItemsToStrings,
  orderTitleForType,
} from "./email-html.ts";
import {
  buildListPdf,
  buildMaterialPdf,
  bytesToBase64,
  type LineItem,
} from "./pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DispatchType = "material" | "rental" | "equipment" | "wallcovering" | "haul_off" | "job_scope_kit";

type DispatchSpec = {
  type: DispatchType;
  to_email: string;
  cc_emails?: string[];
  assign_po?: boolean;
  warehouse_email?: string;
  material_scope?: "paint" | "sundries";
  vendor_name?: string;
};

type SubmitBody = {
  caller_id: string;
  session_token: string;
  client_submit_id?: string;
  resend_order_id?: string;
  resend_dispatch_id?: string;
  order?: {
    job_number: string;
    job_name?: string;
    order_type: "field_request" | "job_scope_kit";
    submitted_by_profile_id: string;
    submitted_by_name: string;
    submitted_by_email: string;
    site_contact: string;
    notes: string;
    delivery_type: string;
    date_needed: string | null;
    crew_kit?: string;
    crew_count?: number;
    phase?: string;
    payload: Record<string, unknown>;
    paint: unknown[];
    materials: unknown[];
    scopes: unknown[];
  };
  dispatches?: DispatchSpec[];
};

type VendorInfo = { name: string; email: string; email2?: string };

type IcbiOrderContacts = {
  pm: string;
  pmEmail: string;
  super: string;
  superEmail: string;
  foremanEmail: string;
  /** ICBI is also the GC on this project — paint POs get a trailing "P" suffix. */
  isGc: boolean;
};

function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function jobInfoFromProjectData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const blob = data as Record<string, unknown>;
  const nested = blob.job_info;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

/** ICBI staff from JobFlow job setup — never GC Info fields. */
function isIcbiGcFlag(value: unknown): boolean {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

async function loadIcbiOrderContacts(
  supabase: ReturnType<typeof createClient>,
  jobCode: string,
  jobName = "",
  projectId = "",
): Promise<IcbiOrderContacts | null> {
  if (projectId) {
    const { data } = await supabase.from("projects").select("data").eq("id", projectId).maybeSingle();
    if (data) {
      const ji = jobInfoFromProjectData(data.data);
      return contactsFromJobInfo(ji);
    }
  }

  const { data } = await supabase
    .from("projects")
    .select("id, job_number, job_name, data")
    .ilike("job_number", jobCode);
  const rows = (data ?? []) as { id: string; job_number: string; job_name: string | null; data: unknown }[];
  if (!rows.length) return null;

  const code = jobCode.trim().toLowerCase();
  const name = jobName.trim().toLowerCase();
  const exact = rows.filter((r) => strField(r.job_number).toLowerCase() === code);
  const pool = exact.length ? exact : rows;
  const named = name
    ? pool.find((r) => strField(r.job_name).toLowerCase() === name)
    : undefined;
  const picked = named ?? pool[0];
  if (!picked) return null;
  return contactsFromJobInfo(jobInfoFromProjectData(picked.data));
}

function contactsFromJobInfo(ji: Record<string, unknown>): IcbiOrderContacts {
  return {
    pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
    pmEmail: strField(ji.icbi_pm_email),
    super: strField(ji.field_request_super),
    superEmail: strField(ji.icbi_super_email),
    foremanEmail: strField(ji.icbi_foreman_email),
    isGc: isIcbiGcFlag(ji.icbi_is_gc),
  };
}

function shouldSuffixIcbiPaintPo(
  isGc: boolean,
  spec: { type: DispatchType; material_scope?: "paint" | "sundries" },
  hasPaint: boolean,
): boolean {
  if (!isGc || !hasPaint) return false;
  if (spec.material_scope === "sundries") return false;
  return spec.type === "material" || spec.type === "job_scope_kit";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asLineItems(arr: unknown): LineItem[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (typeof item === "string") return { raw: item, name: item };
    const o = item as Record<string, unknown>;
    return {
      name: String(o.name ?? o.raw ?? ""),
      quantity: o.quantity != null ? String(o.quantity) : undefined,
      detail: o.detail != null ? String(o.detail) : undefined,
      raw: o.raw != null ? String(o.raw) : undefined,
    };
  });
}

function ccJoin(emails: (string | undefined)[]): string {
  return emails.map((e) => (e ?? "").trim()).filter(Boolean).join(",");
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function asUuid(value: string | undefined): string {
  const s = (value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : "";
}

type ExistingDispatchRow = {
  id: string;
  dispatch_type: string;
  po_number: string;
  to_email: string;
  cc_emails: string;
  subject: string;
  email_status: string;
};

function asDispatchSpecs(value: unknown): DispatchSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const type = String(o.type ?? "");
      if (!type) return null;
      return {
        type: type as DispatchType,
        to_email: String(o.to_email ?? ""),
        cc_emails: Array.isArray(o.cc_emails) ? o.cc_emails.map((e) => String(e)) : undefined,
        assign_po: Boolean(o.assign_po),
        warehouse_email: o.warehouse_email != null ? String(o.warehouse_email) : undefined,
        material_scope: o.material_scope === "paint" || o.material_scope === "sundries" ? o.material_scope : undefined,
        vendor_name: o.vendor_name != null ? String(o.vendor_name) : undefined,
      } satisfies DispatchSpec;
    })
    .filter((s): s is DispatchSpec => Boolean(s));
}

function specsFromDispatchRows(rows: ExistingDispatchRow[]): DispatchSpec[] {
  return rows.map((r) => ({
    type: r.dispatch_type as DispatchType,
    to_email: r.to_email,
    cc_emails: parseEmailList(r.cc_emails),
    assign_po: Boolean(r.po_number),
  }));
}

function matchExistingDispatch(
  rows: ExistingDispatchRow[],
  spec: DispatchSpec,
  index: number,
): ExistingDispatchRow | undefined {
  const typeRows = rows.filter((r) => r.dispatch_type === spec.type);
  const to = spec.to_email.trim().toLowerCase();
  const byEmail = to ? typeRows.filter((r) => r.to_email.trim().toLowerCase() === to) : [];
  if (byEmail.length === 1) return byEmail[0];
  if (typeRows[index]) return typeRows[index];
  return typeRows[0] ?? rows[index];
}

function sanitizeAttachmentPart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** e.g. "1058 Test Job Name PO-1058-009.pdf" */
function buildMaterialOrderAttachmentName(jobCode: string, jobName: string, poNumber: string): string {
  const parts = [sanitizeAttachmentPart(jobCode)].filter(Boolean);
  const name = sanitizeAttachmentPart(jobName);
  if (name) parts.push(name);
  const po = sanitizeAttachmentPart(poNumber).replace(/^PO[-#]?\s*/i, "");
  parts.push(po ? `PO-${po}` : "PO-order");
  return `${parts.join(" ")}.pdf`;
}

async function sendGasEmail(params: {
  to: string;
  cc: string;
  subject: string;
  htmlBody: string;
  attachmentName: string;
  attachmentBase64: string;
  senderName: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = Deno.env.get("GAS_SEND_EMAIL_URL")?.trim();
  if (!base) {
    return { ok: false, message: "GAS_SEND_EMAIL_URL not configured on edge function" };
  }
  const url = `${base}${base.includes("?") ? "&" : "?"}action=sendOrderEmail`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      htmlBody: params.htmlBody,
      attachmentName: params.attachmentName,
      attachmentBase64: params.attachmentBase64,
      senderName: params.senderName,
    }),
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text) as { success?: boolean; error?: string; message?: string };
    if (!res.ok || data.success === false) {
      return { ok: false, message: data.error ?? data.message ?? `GAS HTTP ${res.status}` };
    }
    return { ok: true, message: data.message ?? "Email sent" };
  } catch {
    return { ok: res.ok, message: res.ok ? "Email sent" : text || `GAS HTTP ${res.status}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const companyName = Deno.env.get("COMPANY_NAME")?.trim() || "Ironwood Commercial Builders";
    const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || "Ironwood Commercial Builders";
    const defaultWarehouse = Deno.env.get("DEFAULT_WAREHOUSE_EMAIL")?.trim() || "";

    const supabase = createClient(supabaseUrl, serviceKey);
    const branding = await loadOrderBranding(supabase, companyName);

    const body = (await req.json()) as SubmitBody;
    const callerId = body?.caller_id?.trim();
    const sessionToken = body?.session_token?.trim();
    if (!callerId || !sessionToken) {
      return jsonResponse({ ok: false, error: "caller_id and session_token are required" }, 401);
    }

    const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    if (sessionErr) {
      const msg = /SESSION|INVALID/i.test(sessionErr.message)
        ? "Invalid or expired session. Log in again."
        : sessionErr.message;
      return jsonResponse({ ok: false, error: msg }, 403);
    }
    const profileResult = sessionProfile as {
      ok?: boolean;
      error?: string;
      profile?: { id: string; name: string; email: string; phone?: string; role: string };
    };
    if (!profileResult?.ok || !profileResult.profile) {
      return jsonResponse({ ok: false, error: profileResult?.error ?? "Invalid session" }, 403);
    }
    const trustedProfile = profileResult.profile;

    const { data: profileRow } = await supabase
      .from("field_tools_profiles")
      .select("phone, person_id")
      .eq("id", trustedProfile.id)
      .maybeSingle();
    let orderedByPhone = String(profileRow?.phone ?? trustedProfile.phone ?? "").trim();
    if (profileRow?.person_id) {
      const { data: person } = await supabase
        .from("org_people")
        .select("phone")
        .eq("id", profileRow.person_id)
        .maybeSingle();
      const personPhone = String(person?.phone ?? "").trim();
      if (personPhone) orderedByPhone = personPhone;
    }
    const placedAt = formatOrderDateTime();
    const orderedBy = formatOrderedBy(trustedProfile.name, orderedByPhone, placedAt);

    const { data: orderSettings } = await supabase
      .from("field_tools_order_settings")
      .select("global_cc_emails")
      .eq("id", 1)
      .maybeSingle();
    const globalCcEmails = parseEmailList(String(orderSettings?.global_cc_emails ?? ""));

    const clientSubmitId = asUuid(body.client_submit_id);
    const resendOrderId = asUuid(body.resend_order_id);
    const resendDispatchId = asUuid(body.resend_dispatch_id);
    const isAdminCaller = trustedProfile.role === "admin" || trustedProfile.role === "super";

    type StoredOrder = {
      id: string;
      job_number: string;
      job_name: string | null;
      order_type: string;
      submitted_by_profile_id: string | null;
      site_contact: string;
      notes: string;
      delivery_type: string;
      date_needed: string | null;
      crew_kit: string | null;
      crew_count: number | null;
      phase: string | null;
      payload: Record<string, unknown> | null;
      paint: unknown;
      materials: unknown;
      scopes: unknown;
      po_number: string | null;
      dispatch_specs: unknown;
      status: string;
      email_status: string;
    };

    let stored: StoredOrder | null = null;
    if (resendOrderId) {
      const { data } = await supabase.from("field_tools_orders").select("*").eq("id", resendOrderId).maybeSingle();
      stored = (data as StoredOrder | null) ?? null;
      if (!stored) return jsonResponse({ ok: false, error: "Order not found" }, 404);
      if (stored.submitted_by_profile_id !== trustedProfile.id && !isAdminCaller) {
        return jsonResponse({ ok: false, error: "Access denied" }, 403);
      }
    } else if (clientSubmitId) {
      const { data } = await supabase
        .from("field_tools_orders")
        .select("*")
        .eq("client_submit_id", clientSubmitId)
        .maybeSingle();
      stored = (data as StoredOrder | null) ?? null;
      if (stored && stored.submitted_by_profile_id !== trustedProfile.id && !isAdminCaller) {
        return jsonResponse({ ok: false, error: "Access denied" }, 403);
      }
    }

    if (!stored && (!body?.order?.job_number || !body.dispatches?.length)) {
      return jsonResponse({ ok: false, error: "Invalid submit payload" }, 400);
    }

    const o = stored
      ? {
          job_number: stored.job_number,
          job_name: stored.job_name ?? "",
          order_type: stored.order_type as "field_request" | "job_scope_kit",
          submitted_by_profile_id: stored.submitted_by_profile_id ?? trustedProfile.id,
          submitted_by_name: trustedProfile.name,
          submitted_by_email: trustedProfile.email,
          site_contact: stored.site_contact,
          notes: stored.notes,
          delivery_type: stored.delivery_type,
          date_needed: stored.date_needed,
          crew_kit: stored.crew_kit ?? "",
          crew_count: stored.crew_count ?? 1,
          phase: stored.phase ?? "",
          payload: stored.payload ?? {},
          paint: Array.isArray(stored.paint) ? stored.paint : [],
          materials: Array.isArray(stored.materials) ? stored.materials : [],
          scopes: Array.isArray(stored.scopes) ? stored.scopes : [],
        }
      : body.order!;
    const jobCode = o.job_number.trim();
    const jobName = (o.job_name ?? (o.payload.jobName as string) ?? "").trim();
    const payload = o.payload ?? {};

    if (!stored) {
      const { data: accessProfile } = await supabase
        .from("field_tools_profiles")
        .select("job_access")
        .eq("id", trustedProfile.id)
        .maybeSingle();
      if (String(accessProfile?.job_access ?? "all") !== "all") {
        const { data: links } = await supabase
          .from("field_tools_project_access")
          .select("project_id")
          .eq("profile_id", trustedProfile.id);
        const projectIds = (links ?? []).map((row) => String((row as { project_id: string }).project_id));
        let allowed = false;
        if (projectIds.length) {
          const { data: jobs } = await supabase.from("projects").select("job_number").in("id", projectIds);
          allowed = (jobs ?? []).some(
            (row) => String((row as { job_number?: string }).job_number ?? "").trim().toLowerCase() === jobCode.toLowerCase(),
          );
        }
        if (!allowed) {
          return jsonResponse({ ok: false, error: "You don't have access to this job." }, 403);
        }
      }
    }

    let orderId = stored?.id ?? "";
    if (!stored) {
      const { data: orderRow, error: insertErr } = await supabase
        .from("field_tools_orders")
        .insert({
          job_number: jobCode,
          job_name: jobName,
          order_type: o.order_type,
          submitted_by_profile_id: trustedProfile.id,
          submitted_by_name: trustedProfile.name,
          submitted_by_email: trustedProfile.email,
          site_contact: o.site_contact,
          notes: o.notes,
          delivery_type: o.delivery_type,
          date_needed: o.date_needed,
          crew_kit: o.crew_kit ?? "",
          crew_count: o.crew_count ?? 1,
          phase: o.phase ?? "",
          payload: o.payload,
          paint: o.paint,
          materials: o.materials,
          scopes: o.scopes,
          status: "submitted",
          email_status: "pending",
          client_submit_id: clientSubmitId || null,
          dispatch_specs: body.dispatches ?? [],
        })
        .select("id")
        .single();

      if (insertErr?.code === "23505" && clientSubmitId) {
        const { data: raced } = await supabase
          .from("field_tools_orders")
          .select("*")
          .eq("client_submit_id", clientSubmitId)
          .maybeSingle();
        stored = (raced as StoredOrder | null) ?? null;
        orderId = stored?.id ?? "";
      } else if (insertErr || !orderRow) {
        return jsonResponse({ ok: false, error: insertErr?.message ?? "Order insert failed" }, 500);
      } else {
        orderId = orderRow.id as string;
      }
    }

    if (!orderId) {
      return jsonResponse({ ok: false, error: "Order insert failed" }, 500);
    }

    const { data: existingDispatchData } = await supabase
      .from("field_tools_order_dispatches")
      .select("id, dispatch_type, po_number, to_email, cc_emails, subject, email_status")
      .eq("order_id", orderId);
    const existingDispatches = (existingDispatchData ?? []) as ExistingDispatchRow[];

    let dispatchSpecs = asDispatchSpecs(stored?.dispatch_specs);
    if (!dispatchSpecs.length) dispatchSpecs = body.dispatches ?? [];
    if (!dispatchSpecs.length) dispatchSpecs = specsFromDispatchRows(existingDispatches);
    if (!dispatchSpecs.length) {
      return jsonResponse({ ok: false, error: "No dispatches to send" }, 400);
    }
    if (asDispatchSpecs(stored?.dispatch_specs).length === 0) {
      await supabase.from("field_tools_orders").update({ dispatch_specs: dispatchSpecs }).eq("id", orderId);
    }

    if (existingDispatches.length && existingDispatches.every((d) => d.email_status === "sent") && !resendDispatchId) {
      const poLabel = existingDispatches.map((d) => d.po_number).filter(Boolean).join(", ") || stored?.po_number || "";
      return jsonResponse({
        ok: true,
        order_id: orderId,
        po_number: poLabel || null,
        dispatches: existingDispatches.map((d) => ({
          type: d.dispatch_type,
          po_number: d.po_number || undefined,
          ok: true,
          message: "Already sent",
        })),
        message: `Order submitted${poLabel ? ` — PO# ${poLabel}` : ""}`,
      });
    }
    const paintVendor = payload.vendor as VendorInfo | string | undefined;
    const vendorName = typeof paintVendor === "string" ? paintVendor : paintVendor?.name ?? "";
    const rentalVendor = payload.rentalVendor as VendorInfo | undefined;

    const projectId = strField(payload.projectId ?? payload.project_id);
    const icbi = await loadIcbiOrderContacts(supabase, jobCode, jobName, projectId);
    const pm = icbi?.pm || String(payload.pm ?? "");
    const pmEmail = icbi ? icbi.pmEmail : String(payload.pmEmail ?? "");
    const superName = icbi?.super || String(payload.super ?? "");
    const superEmail = icbi ? icbi.superEmail : String(payload.superEmail ?? "");
    const foreman = icbi
      ? icbi.foremanEmail || trustedProfile.email
      : String(payload.foreman ?? trustedProfile.email);

    const lists = payload.lists as Record<string, unknown> | undefined;
    const sections = payload.sections as Record<string, unknown> | undefined;

    const paintItems = asLineItems(lists?.paint ?? o.paint);
    const sundryItems = asLineItems(lists?.sundries ?? []);
    const additionalItems = asLineItems(lists?.additional ?? []);
    const rentalItems = asLineItems(lists?.rental ?? []);
    const equipmentItems = asLineItems(lists?.equipment ?? []);
    const wcItems = asLineItems(lists?.wallcovering ?? []);

    const siteContactLabel = o.delivery_type === "willCall" ? "Pick up person" : "Site contact";

    const baseMeta = {
      branding,
      jobCode,
      jobName,
      orderedBy,
      generatedAt: placedAt,
      siteContact: o.site_contact,
      siteContactLabel,
      dateNeeded: o.date_needed ?? "",
      notes: o.notes,
      pm,
      super: superName,
    };

    const results: { type: string; po_number?: string; ok: boolean; message: string }[] = [];
    const assignedPos: string[] = [];

    for (let specIndex = 0; specIndex < dispatchSpecs.length; specIndex++) {
      const spec = dispatchSpecs[specIndex];
      const existingDispatch = matchExistingDispatch(existingDispatches, spec, specIndex);
      if (resendDispatchId && existingDispatch && existingDispatch.id !== resendDispatchId) {
        results.push({
          type: spec.type,
          po_number: existingDispatch.po_number || undefined,
          ok: existingDispatch.email_status === "sent",
          message: existingDispatch.email_status === "sent" ? "Already sent" : existingDispatch.email_status,
        });
        if (existingDispatch.po_number) assignedPos.push(existingDispatch.po_number);
        continue;
      }
      if (existingDispatch?.email_status === "sent" && existingDispatch.id !== resendDispatchId) {
        results.push({
          type: spec.type,
          po_number: existingDispatch.po_number || undefined,
          ok: true,
          message: "Already sent",
        });
        if (existingDispatch.po_number) assignedPos.push(existingDispatch.po_number);
        continue;
      }

      let poNumber = existingDispatch?.po_number ?? "";
      if (!poNumber && spec.assign_po) {
        const { data: po, error: poErr } = await supabase.rpc("field_tools_next_po_number", {
          p_job_code: jobCode,
        });
        if (poErr) {
          results.push({ type: spec.type, ok: false, message: poErr.message });
          continue;
        }
        poNumber = String(po);
        const hasPaint =
          paintItems.length > 0 ||
          additionalItems.length > 0 ||
          (spec.type === "job_scope_kit" && spec.material_scope !== "sundries");
        // ICBI-as-GC jobs: mark self-perform paint POs so they're distinguishable
        // from ICBI's GC-side PO accounting, which uses the same shared job sequence.
        if (shouldSuffixIcbiPaintPo(Boolean(icbi?.isGc), spec, hasPaint)) {
          poNumber = poNumber.endsWith("P") ? poNumber : `${poNumber}P`;
        }
      }
      if (poNumber) assignedPos.push(poNumber);

      let pdfBytes: Uint8Array;
      let subject: string;
      let attachmentName: string;
      let emailSections: { title: string; lines: string[] }[] = [];
      let vendorLabel = "";
      let emailOrderTitle = orderTitleForType(spec.type);

      switch (spec.type) {
        case "material":
        case "job_scope_kit": {
          const materialScope = spec.material_scope;
          const dispatchVendor = String(spec.vendor_name ?? vendorName);
          const pdfPaint = materialScope === "sundries" ? [] : paintItems;
          const pdfSundries =
            materialScope === "paint"
              ? []
              : spec.type === "job_scope_kit"
                ? asLineItems(o.materials)
                : sundryItems;
          const pdfAdditional = materialScope === "sundries" ? [] : additionalItems;
          const orderLabel = materialScope === "sundries" ? "Sundries Order" : "Material Order";
          emailOrderTitle = orderLabel;
          subject = `${formatJobProjectLabel(jobCode, jobName)} — ${orderLabel}${poNumber ? ` — PO# ${poNumber}` : ""}`;
          attachmentName = buildMaterialOrderAttachmentName(jobCode, jobName, poNumber);
          vendorLabel = dispatchVendor;
          pdfBytes = await buildMaterialPdf({
            ...baseMeta,
            poNumber,
            vendor: dispatchVendor,
            paint: pdfPaint,
            sundries: pdfSundries,
            additional: pdfAdditional,
          });
          emailSections = [
            ...(pdfPaint.length
              ? [{ title: "Paint", lines: lineItemsToStrings(pdfPaint) }]
              : []),
            ...(pdfSundries.length || pdfAdditional.length
              ? [
                  {
                    title: materialScope === "sundries" ? "Sundries" : "Sundries / Materials",
                    lines: lineItemsToStrings(
                      materialScope === "paint" ? pdfAdditional : [...pdfSundries, ...pdfAdditional],
                    ),
                  },
                ]
              : []),
          ];
          break;
        }
        case "rental": {
          subject = `${formatJobProjectLabel(jobCode, jobName)} — Rental Order`;
          attachmentName = `${jobCode}-rental.pdf`;
          vendorLabel = rentalVendor?.name ?? "";
          pdfBytes = await buildListPdf({
            ...baseMeta,
            title: "Rental Order",
            sectionLabel: "Rental Equipment",
            items: rentalItems,
            vendorOrRep: rentalVendor?.name,
          });
          emailSections = [{ title: "Rental", lines: lineItemsToStrings(rentalItems) }];
          break;
        }
        case "equipment": {
          subject = `${formatJobProjectLabel(jobCode, jobName)} — Equipment Order`;
          attachmentName = `${jobCode}-equipment.pdf`;
          pdfBytes = await buildListPdf({
            ...baseMeta,
            title: "Equipment Order",
            sectionLabel: "Equipment",
            items: equipmentItems,
          });
          emailSections = [{ title: "Equipment", lines: lineItemsToStrings(equipmentItems) }];
          break;
        }
        case "wallcovering": {
          subject = `${formatJobProjectLabel(jobCode, jobName)} — Wallcovering Order`;
          attachmentName = `${jobCode}-wallcovering.pdf`;
          pdfBytes = await buildListPdf({
            ...baseMeta,
            title: "Wallcovering Order",
            sectionLabel: "Wallcovering",
            items: wcItems,
          });
          emailSections = [{ title: "Wallcovering", lines: lineItemsToStrings(wcItems) }];
          break;
        }
        case "haul_off": {
          const haulNotes = String(sections?.haulOffNotes ?? o.notes ?? "");
          subject = `${formatJobProjectLabel(jobCode, jobName)} — Haul Off Request`;
          attachmentName = `${jobCode}-haul-off.pdf`;
          pdfBytes = await buildListPdf({
            ...baseMeta,
            title: "Haul Off Request",
            sectionLabel: "Instructions",
            items: [{ name: haulNotes || "See notes" }],
            notes: haulNotes,
          });
          emailSections = [{ title: "Haul off", lines: [haulNotes] }];
          break;
        }
        default:
          results.push({ type: spec.type, ok: false, message: "Unknown dispatch type" });
          continue;
      }

      const to =
        spec.type === "equipment" || spec.type === "haul_off"
          ? (spec.warehouse_email || spec.to_email || defaultWarehouse).trim()
          : spec.to_email.trim();

      if (!to) {
        const failedRow = {
          order_id: orderId,
          dispatch_type: spec.type,
          po_number: poNumber,
          to_email: "",
          cc_emails: "",
          subject,
          email_status: "failed",
          gas_response: { error: "No recipient email" },
        };
        if (existingDispatch) {
          await supabase.from("field_tools_order_dispatches").update(failedRow).eq("id", existingDispatch.id);
        } else {
          await supabase.from("field_tools_order_dispatches").insert(failedRow);
        }
        results.push({ type: spec.type, po_number: poNumber || undefined, ok: false, message: "No recipient email" });
        continue;
      }

      const cc = ccJoin([
        ...(spec.cc_emails ?? []),
        ...globalCcEmails,
        pmEmail,
        superEmail,
        foreman,
        spec.type === "rental" ? rentalVendor?.email2 : "",
      ]);

      let htmlBody = buildOrderEmailHtml({
        branding,
        orderTitle: emailOrderTitle,
        jobCode,
        jobName,
        orderedBy: orderedBy || undefined,
        poNumber: poNumber || undefined,
        siteContact: o.site_contact,
        siteContactLabel,
        dateNeeded: o.date_needed ?? "",
        notes: o.notes,
        vendorLabel: vendorLabel || undefined,
        pm: pm || undefined,
        super: superName || undefined,
        sections: emailSections,
      });
      htmlBody = await embedLogoUrlInHtml(htmlBody, branding.logoUrl);

      const gas = await sendGasEmail({
        to,
        cc,
        subject,
        htmlBody,
        attachmentName,
        attachmentBase64: bytesToBase64(pdfBytes),
        senderName,
      });

      const dispatchRow = {
        order_id: orderId,
        dispatch_type: spec.type,
        po_number: poNumber,
        to_email: to,
        cc_emails: cc,
        subject,
        email_status: gas.ok ? "sent" : "failed",
        gas_response: { message: gas.message },
        emailed_at: gas.ok ? new Date().toISOString() : null,
      };
      if (existingDispatch) {
        await supabase.from("field_tools_order_dispatches").update(dispatchRow).eq("id", existingDispatch.id);
      } else {
        await supabase.from("field_tools_order_dispatches").insert(dispatchRow);
      }

      results.push({
        type: spec.type,
        po_number: poNumber || undefined,
        ok: gas.ok,
        message: gas.message,
      });
    }

    await supabase.rpc("field_tools_refresh_order_email_status", { p_order_id: orderId });

    const uniquePos = [...new Set(assignedPos.filter(Boolean))];
    const orderPoLabel = uniquePos.join(", ");

    if (uniquePos.length) {
      await supabase.from("field_tools_orders").update({ po_number: orderPoLabel }).eq("id", orderId);
    }

    const allOk = results.every((r) => r.ok);
    const anyOk = results.some((r) => r.ok);

    await supabase
      .from("field_tools_orders")
      .update({
        gas_response: { dispatches: results },
        status: allOk ? "confirmed" : anyOk ? "submitted" : "failed",
        last_submit_error: allOk ? "" : results.filter((r) => !r.ok).map((r) => `${r.type}: ${r.message}`).join(" · "),
      })
      .eq("id", orderId);

    return jsonResponse({
      ok: allOk,
      order_id: orderId,
      po_number: orderPoLabel || null,
      dispatches: results,
      message: allOk
        ? `Order submitted${orderPoLabel ? ` — PO# ${orderPoLabel}` : ""}`
        : results.map((r) => `${r.type}: ${r.message}`).join(" · "),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Submit failed";
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
