import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { embedLogoUrlInHtml, loadOrderBranding } from "./branding.ts";
import { buildOrderEmailHtml, lineItemsToStrings, orderTitleForType } from "./email-html.ts";
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

type SubmitBody = {
  order: {
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
  dispatches: {
    type: DispatchType;
    to_email: string;
    cc_emails?: string[];
    assign_po?: boolean;
    warehouse_email?: string;
    material_scope?: "paint" | "sundries";
    vendor_name?: string;
  }[];
};

type VendorInfo = { name: string; email: string; email2?: string };

type IcbiOrderContacts = {
  pm: string;
  pmEmail: string;
  super: string;
  superEmail: string;
  foremanEmail: string;
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
async function loadIcbiOrderContacts(
  supabase: ReturnType<typeof createClient>,
  jobCode: string,
): Promise<IcbiOrderContacts | null> {
  const { data } = await supabase
    .from("projects")
    .select("data")
    .ilike("job_number", jobCode)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const ji = jobInfoFromProjectData(data.data);
  return {
    pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
    pmEmail: strField(ji.icbi_pm_email),
    super: strField(ji.field_request_super),
    superEmail: strField(ji.icbi_super_email),
    foremanEmail: strField(ji.icbi_foreman_email),
  };
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

    const { data: orderSettings } = await supabase
      .from("field_tools_order_settings")
      .select("global_cc_emails")
      .eq("id", 1)
      .maybeSingle();
    const globalCcEmails = parseEmailList(String(orderSettings?.global_cc_emails ?? ""));

    const body = (await req.json()) as SubmitBody;
    if (!body?.order?.job_number || !body.dispatches?.length) {
      return jsonResponse({ ok: false, error: "Invalid submit payload" }, 400);
    }

    const o = body.order;
    const jobCode = o.job_number.trim();
    const jobName = (o.job_name ?? (o.payload.jobName as string) ?? "").trim();
    const payload = o.payload ?? {};

    const { data: orderRow, error: insertErr } = await supabase
      .from("field_tools_orders")
      .insert({
        job_number: jobCode,
        job_name: jobName,
        order_type: o.order_type,
        submitted_by_profile_id: o.submitted_by_profile_id,
        submitted_by_name: o.submitted_by_name,
        submitted_by_email: o.submitted_by_email,
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
      })
      .select("id")
      .single();

    if (insertErr || !orderRow) {
      return jsonResponse({ ok: false, error: insertErr?.message ?? "Order insert failed" }, 500);
    }

    const orderId = orderRow.id as string;
    const paintVendor = payload.vendor as VendorInfo | string | undefined;
    const vendorName = typeof paintVendor === "string" ? paintVendor : paintVendor?.name ?? "";
    const rentalVendor = payload.rentalVendor as VendorInfo | undefined;

    const icbi = await loadIcbiOrderContacts(supabase, jobCode);
    const pm = icbi?.pm || String(payload.pm ?? "");
    const pmEmail = icbi ? icbi.pmEmail : String(payload.pmEmail ?? "");
    const superName = icbi?.super || String(payload.super ?? "");
    const superEmail = icbi ? icbi.superEmail : String(payload.superEmail ?? "");
    const foreman = icbi
      ? icbi.foremanEmail || String(o.submitted_by_email ?? "")
      : String(payload.foreman ?? o.submitted_by_email ?? "");

    const lists = payload.lists as Record<string, unknown> | undefined;
    const sections = payload.sections as Record<string, unknown> | undefined;

    const paintItems = asLineItems(lists?.paint ?? o.paint);
    const sundryItems = asLineItems(lists?.sundries ?? []);
    const additionalItems = asLineItems(lists?.additional ?? []);
    const rentalItems = asLineItems(lists?.rental ?? []);
    const equipmentItems = asLineItems(lists?.equipment ?? []);
    const wcItems = asLineItems(lists?.wallcovering ?? []);

    const baseMeta = {
      branding,
      jobCode,
      jobName,
      siteContact: o.site_contact,
      dateNeeded: o.date_needed ?? "",
      notes: o.notes,
      pm,
      super: superName,
    };

    const results: { type: string; po_number?: string; ok: boolean; message: string }[] = [];
    const assignedPos: string[] = [];

    for (const spec of body.dispatches) {
      let poNumber = "";
      if (spec.assign_po) {
        const { data: po, error: poErr } = await supabase.rpc("field_tools_next_po_number", {
          p_job_code: jobCode,
        });
        if (poErr) {
          results.push({ type: spec.type, ok: false, message: poErr.message });
          continue;
        }
        poNumber = String(po);
        assignedPos.push(poNumber);
      }

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
          subject = `${jobCode}${jobName ? ` — ${jobName}` : ""} — ${orderLabel}${poNumber ? ` — PO# ${poNumber}` : ""}`;
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
          subject = `${jobCode}${jobName ? ` — ${jobName}` : ""} — Rental Order`;
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
          subject = `${jobCode}${jobName ? ` — ${jobName}` : ""} — Equipment Order`;
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
          subject = `${jobCode}${jobName ? ` — ${jobName}` : ""} — Wallcovering Order`;
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
          subject = `${jobCode}${jobName ? ` — ${jobName}` : ""} — Haul Off Request`;
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
        await supabase.from("field_tools_order_dispatches").insert({
          order_id: orderId,
          dispatch_type: spec.type,
          po_number: poNumber,
          to_email: "",
          cc_emails: "",
          subject,
          email_status: "failed",
          gas_response: { error: "No recipient email" },
        });
        results.push({ type: spec.type, po_number: poNumber || undefined, ok: false, message: "No recipient email" });
        continue;
      }

      const cc = ccJoin([
        ...(spec.cc_emails ?? []),
        ...globalCcEmails,
        pmEmail,
        superEmail,
        foreman,
        spec.type === "material" || spec.type === "job_scope_kit"
          ? spec.type === "material" && spec.material_scope === "sundries"
            ? ""
            : typeof paintVendor === "object"
              ? paintVendor?.email2
              : ""
          : rentalVendor?.email2,
      ]);

      let htmlBody = buildOrderEmailHtml({
        branding,
        orderTitle: emailOrderTitle,
        jobCode,
        jobName,
        poNumber: poNumber || undefined,
        siteContact: o.site_contact,
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

      await supabase.from("field_tools_order_dispatches").insert({
        order_id: orderId,
        dispatch_type: spec.type,
        po_number: poNumber,
        to_email: to,
        cc_emails: cc,
        subject,
        email_status: gas.ok ? "sent" : "failed",
        gas_response: { message: gas.message },
        emailed_at: gas.ok ? new Date().toISOString() : null,
      });

      results.push({
        type: spec.type,
        po_number: poNumber || undefined,
        ok: gas.ok,
        message: gas.message,
      });
    }

    await supabase.rpc("field_tools_refresh_order_email_status", { p_order_id: orderId });

    const orderPoLabel = assignedPos.join(", ");

    if (assignedPos.length) {
      await supabase.from("field_tools_orders").update({ po_number: orderPoLabel }).eq("id", orderId);
    }

    const allOk = results.every((r) => r.ok);
    const anyOk = results.some((r) => r.ok);

    await supabase
      .from("field_tools_orders")
      .update({
        gas_response: { dispatches: results },
        status: allOk ? "confirmed" : anyOk ? "submitted" : "failed",
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
