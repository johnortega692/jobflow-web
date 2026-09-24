import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DIGEST_PDF_NAME = "JobFlow-notification.pdf";
const DIGEST_PDF_BASE64 =
  "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdPj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTUKJSVFT0YK";

type AlertRow = {
  project_id: string;
  job_label: string;
  pm_email: string | null;
  attempt_count: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function postGas(
  base: string,
  action: "sendJobFlowEmail" | "sendOrderEmail",
  params: {
    to: string;
    subject: string;
    htmlBody: string;
    senderName: string;
    attachmentName?: string;
    attachmentBase64?: string;
  },
): Promise<{ ok: boolean; message: string }> {
  const url = `${base}${base.includes("?") ? "&" : "?"}action=${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: params.to,
      cc: "",
      subject: params.subject,
      htmlBody: params.htmlBody,
      senderName: params.senderName,
      attachmentName: params.attachmentName ?? "",
      attachmentBase64: params.attachmentBase64 ?? "",
    }),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { success?: boolean; error?: string; message?: string };
    if (!res.ok || data.success === false) {
      return { ok: false, message: data.error ?? data.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, message: data.message ?? "sent" };
  } catch {
    const looksHtml = text.trim().startsWith("<");
    return { ok: false, message: looksHtml ? "Email service was busy" : text.slice(0, 200) };
  }
}

async function sendAlertEmail(params: {
  to: string;
  subject: string;
  htmlBody: string;
  senderName: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = Deno.env.get("GAS_SEND_EMAIL_URL")?.trim();
  if (!base) return { ok: false, message: "GAS_SEND_EMAIL_URL not configured" };
  const jobFlow = await postGas(base, "sendJobFlowEmail", params);
  if (jobFlow.ok) return jobFlow;
  return await postGas(base, "sendOrderEmail", {
    ...params,
    attachmentName: DIGEST_PDF_NAME,
    attachmentBase64: DIGEST_PDF_BASE64,
  });
}

function alertHtml(jobLabel: string): string {
  const job = escapeHtml(jobLabel);
  return `<p>Manpower was scheduled on <strong>${job}</strong>.</p>
<p><strong>Budget enter FSI</strong> is still unchecked on Project Startup.</p>
<p>This is a one-time notice. Later crew assignments on this job will not send again.</p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || "JobFlow";
    const supabase = createClient(supabaseUrl, serviceKey);

    let secret = "";
    try {
      const body = (await req.json()) as { secret?: string };
      secret = (body?.secret ?? "").trim();
    } catch {
      secret = "";
    }

    const { data: settings } = await supabase
      .from("field_tools_link_settings")
      .select("cron_secret")
      .eq("id", 1)
      .maybeSingle();
    const expected = String(settings?.cron_secret ?? "").trim();
    if (!expected || secret !== expected) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: rows, error: loadErr } = await supabase
      .from("manpower_fsi_budget_alerts")
      .select("project_id, job_label, pm_email, attempt_count")
      .in("status", ["queued", "error"])
      .is("sent_at", null)
      .lt("attempt_count", 5)
      .order("queued_at", { ascending: true })
      .limit(20);
    if (loadErr) return jsonResponse({ ok: false, error: loadErr.message }, 500);

    const alerts = (rows ?? []) as AlertRow[];
    let sent = 0;
    let failed = 0;
    for (const row of alerts) {
      const to = (row.pm_email ?? "").trim();
      const jobLabel = (row.job_label ?? "").trim() || "this job";
      const nextAttempt = (row.attempt_count ?? 0) + 1;
      if (!to) {
        await supabase
          .from("manpower_fsi_budget_alerts")
          .update({
            status: "skipped",
            skip_reason: "missing_pm_email",
            last_error: "PM email missing at send time",
            attempt_count: nextAttempt,
          })
          .eq("project_id", row.project_id);
        continue;
      }

      const result = await sendAlertEmail({
        to,
        subject: `JobFlow: Manpower scheduled — Budget enter FSI still open (${jobLabel})`,
        htmlBody: alertHtml(jobLabel),
        senderName,
      });

      if (result.ok) {
        sent += 1;
        await supabase
          .from("manpower_fsi_budget_alerts")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: null,
            attempt_count: nextAttempt,
          })
          .eq("project_id", row.project_id);
      } else {
        failed += 1;
        await supabase
          .from("manpower_fsi_budget_alerts")
          .update({
            status: "error",
            last_error: result.message.slice(0, 400),
            attempt_count: nextAttempt,
          })
          .eq("project_id", row.project_id);
      }
    }

    return jsonResponse({ ok: true, queued: alerts.length, sent, failed });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Alert failed" }, 500);
  }
});
