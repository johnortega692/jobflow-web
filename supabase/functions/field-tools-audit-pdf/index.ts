import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadOrderBranding } from "./branding.ts";
import { type AuditOrder } from "./order-groups.ts";
import { buildAuditPdf, bytesToBase64 } from "./pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AuditBody = {
  caller_id: string;
  session_token: string;
  job_number: string;
  job_name?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const companyName = Deno.env.get("COMPANY_NAME")?.trim() || "Ironwood Commercial Builders";

    const body = (await req.json()) as AuditBody;
    const callerId = body?.caller_id?.trim();
    const sessionToken = body?.session_token?.trim();
    const jobNumber = body?.job_number?.trim();

    if (!callerId || !sessionToken || !jobNumber) {
      return jsonResponse({ ok: false, error: "caller_id, session_token, and job_number are required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: listData, error: listErr } = await supabase.rpc("field_tools_admin_list_orders_by_job", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
      p_job_number: jobNumber,
    });

    if (listErr) {
      const msg = listErr.message.includes("ADMIN_REQUIRED") ? "Admin access required" : listErr.message;
      return jsonResponse({ ok: false, error: msg }, 403);
    }

    const listResult = listData as {
      ok?: boolean;
      error?: string;
      job_number?: string;
      job_name?: string;
      orders?: AuditOrder[];
    };

    if (!listResult?.ok) {
      return jsonResponse({ ok: false, error: listResult?.error ?? "Failed to load orders" }, 400);
    }

    const orders = listResult.orders ?? [];
    if (!orders.length) {
      return jsonResponse({ ok: false, error: "No orders found for this project" }, 404);
    }

    const jobName = (body.job_name ?? listResult.job_name ?? "").trim();
    const branding = await loadOrderBranding(supabase, companyName);
    const pdfBytes = await buildAuditPdf({
      branding,
      jobNumber: listResult.job_number ?? jobNumber,
      jobName,
      orders,
    });

    const safeJob = (listResult.job_number ?? jobNumber).replace(/[^\w.-]+/g, "-");
    const filename = `${safeJob}-order-audit.pdf`;

    return jsonResponse({
      ok: true,
      filename,
      pdf_base64: bytesToBase64(pdfBytes),
      order_count: orders.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Audit export failed";
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
