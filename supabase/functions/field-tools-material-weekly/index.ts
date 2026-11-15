import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendJobFlowNotification } from "./sendJobFlowEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEST_TO = "johnortega@gmail.com";

type JobRow = {
  job_number?: string;
  job_name?: string;
  budget?: number | string;
  ordered?: number | string;
};

type Report = {
  ok?: boolean;
  error?: string;
  enabled?: boolean;
  recipients?: string;
  threshold_percent?: number;
  week_of?: string;
  jobs?: JobRow[];
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function emailList(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));
}

function money(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function percent(ordered: number, budget: number): string {
  if (budget <= 0) return "";
  return `${Math.round((ordered / budget) * 100)}%`;
}

function buildMessage(report: Report) {
  const threshold = report.threshold_percent ?? 80;
  const jobs = report.jobs ?? [];
  const subject = jobs.length ? "Jobs over the material budget" : "Material budget";
  const lines = jobs.map((job) => {
    const budget = Number(job.budget) || 0;
    const ordered = Number(job.ordered) || 0;
    const name = `${job.job_number ?? ""}${job.job_name ? ` ${job.job_name}` : ""}`.trim();
    return `${name}: ordered ${money(ordered)} of ${money(budget)} (${percent(ordered, budget)})`;
  });
  const text = jobs.length
    ? [`Jobs at ${threshold}% or more of their material budget. Ordered amounts include sales tax.`, "", ...lines].join("\n")
    : `No jobs are at ${threshold}% or more of their material budget.`;
  const rows = jobs
    .map((job) => {
      const budget = Number(job.budget) || 0;
      const ordered = Number(job.ordered) || 0;
      const name = esc(`${job.job_number ?? ""}${job.job_name ? ` — ${job.job_name}` : ""}`.trim());
      return `<tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb">${name}</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb">${esc(money(ordered))}</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb">${esc(money(budget))}</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb">${esc(percent(ordered, budget))}</td></tr>`;
    })
    .join("");
  const html = jobs.length
    ? `<p>Jobs at ${threshold}% or more of their material budget. Ordered amounts include sales tax.</p>`<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px"><thead><tr><th align="left" style="padding:6px 8px">Job</th><th align="left" style="padding:6px 8px">Ordered</th><th align="left" style="padding:6px 8px">Budget</th><th align="left" style="padding:6px 8px">Used</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>No jobs are at ${threshold}% or more of their material budget.</p>`;
  return { subject, text, html };
}

async function requireAdmin(supabase: ReturnType<typeof createClient>, callerId: string, sessionToken: string) {
  const { data, error } = await supabase.rpc("field_tools_get_session_profile", {
    p_caller_id: callerId,
    p_session_token: sessionToken,
  });
  const session = data as { ok?: boolean; profile?: { role?: string } } | null;
  if (error || !session?.ok) return jsonResponse({ ok: false, error: "Invalid or expired session. Log in again." }, 403);
  if (session.profile?.role !== "admin" && session.profile?.role !== "super") {
    return jsonResponse({ ok: false, error: "Admin access required" }, 403);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = (await req.json()) as { action?: string; secret?: string; caller_id?: string; session_token?: string };

    if (body.action === "send_test") {
      const denied = await requireAdmin(supabase, body.caller_id?.trim() ?? "", body.session_token?.trim() ?? "");
      if (denied) return denied;
      const { data, error } = await supabase.rpc("field_tools_material_report_build");
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);
      const report = data as Report;
      const message = buildMessage(report);
      const subject = `[TEST] ${message.subject}`;
      const sent = await sendJobFlowNotification({
        to: TEST_TO,
        subject,
        htmlBody: message.html,
        text: message.text,
        jobFlowOnly: true,
      });
      if (!sent.ok) return jsonResponse({ ok: false, error: sent.message }, 502);
      return jsonResponse({ ok: true, emailed: true, to: TEST_TO, subject });
    }

    if (body.action !== "send") return jsonResponse({ ok: false, error: "Unknown action" }, 400);
    const secret = body.secret?.trim() ?? "";
    if (!secret) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

    const { data, error } = await supabase.rpc("field_tools_material_report_build");
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    const report = data as Report;
    if (!report?.ok) return jsonResponse({ ok: false, error: report?.error ?? "Could not build the report." }, 500);
    if (!report.enabled) return jsonResponse({ ok: true, emailed: false, reason: "disabled" });
    const jobs = report.jobs ?? [];
    if (!jobs.length) return jsonResponse({ ok: true, emailed: false, reason: "no_jobs" });
    const recipients = emailList(report.recipients ?? "");
    if (!recipients.length) return jsonResponse({ ok: true, emailed: false, reason: "no_recipients" });

    const claimed = await supabase.rpc("field_tools_material_report_claim", {
      p_secret: secret,
      p_week_of: report.week_of,
    });
    const claim = claimed.data as { ok?: boolean; claimed?: boolean } | null;
    if (claimed.error || !claim?.ok) return jsonResponse({ ok: false, error: "Could not reserve this week's email." }, 500);
    if (!claim.claimed) return jsonResponse({ ok: true, emailed: false, reason: "already_sent" });

    const message = buildMessage(report);
    const sent = await sendJobFlowNotification({
      to: recipients[0]!,
      cc: recipients.slice(1).join(","),
      subject: message.subject,
      htmlBody: message.html,
      text: message.text,
      jobFlowOnly: true,
    });
    if (!sent.ok) {
      await supabase.rpc("field_tools_material_report_release", { p_secret: secret, p_week_of: report.week_of });
      return jsonResponse({ ok: false, error: sent.message }, 502);
    }
    return jsonResponse({ ok: true, emailed: true, jobs: jobs.length });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Request failed" }, 500);
  }
});
