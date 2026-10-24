import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PDF_CHARS = 9_000_000;
const MAX_LINES = 45;

type Line = {
  expense_date: string;
  description: string;
  amount: string;
  job_number: string;
  job_name: string;
  cost_code: string;
  cents: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function strField(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanText(value: unknown, max: number): string {
  return strField(value).replace(/[\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function asUuid(value: unknown): string {
  const text = strField(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part));
}

function amountCents(raw: string): number | null {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 9_999_999) return null;
  return cents;
}

function utcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  return date.getTime();
}

function formatMoney(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${fraction}`;
}

function formatFormDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function fileName(employeeName: string, dateIso: string): string {
  const slug = employeeName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "Employee";
  return `${dateIso}_${slug}_Reimbursement.pdf`;
}

function isSignature(raw: string): boolean {
  const value = raw.trim();
  return value.length > 80 && value.length < 500_000 && /^data:image\/(png|jpeg|jpg);base64,/i.test(value);
}

function normalizePdfBase64(raw: string): string {
  let value = raw.trim().replace(/^\uFEFF/, "");
  const mark = value.toLowerCase().indexOf("base64,");
  if (mark >= 0) value = value.slice(mark + "base64,".length);
  return value.replace(/\s/g, "");
}

function isPdfBase64(value: string): boolean {
  if (!value || value.length > MAX_PDF_CHARS) return false;
  if (value.startsWith("JVBERi")) return true;
  try {
    return atob(value.slice(0, 24)).startsWith("%PDF");
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linesFromBody(raw: unknown): { lines: Line[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Add at least one expense." };
  if (raw.length > MAX_LINES) return { error: "This request holds 45 expenses. Send this one, then start another." };
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const latest = utcToday + 86_400_000;
  const earliest = Date.UTC(2020, 0, 1);
  const lines: Line[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "An expense is missing." };
    const row = item as Record<string, unknown>;
    const expenseDate = strField(row.expense_date);
    const when = utcDay(expenseDate);
    if (when == null || when < earliest) return { error: "Enter the receipt date." };
    if (when > latest) return { error: "A receipt date is in the future." };
    const description = cleanText(row.description, 200);
    if (!description) return { error: "Say what the expense was." };
    const amount = strField(row.amount);
    const cents = amountCents(amount);
    if (cents == null) return { error: "Enter an amount." };
    const jobNumber = cleanText(row.job_number, 40);
    if (!jobNumber) return { error: "Choose the job." };
    const costCode = cleanText(row.cost_code, 40);
    if (!costCode) return { error: "Enter the cost code." };
    lines.push({
      expense_date: expenseDate,
      description,
      amount,
      job_number: jobNumber,
      job_name: cleanText(row.job_name, 120),
      cost_code: costCode,
      cents,
    });
  }
  return { lines };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as Record<string, unknown>;
    const callerId = strField(body.caller_id || body.p_caller_id);
    const sessionToken = strField(body.session_token || body.p_session_token);
    if (!callerId || !sessionToken) return jsonResponse({ ok: false, error: "Sign in again, then send the form." }, 401);

    const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    if (sessionErr) {
      const message = /SESSION|INVALID/i.test(sessionErr.message) ? "Invalid or expired session. Log in again." : sessionErr.message;
      return jsonResponse({ ok: false, error: message }, 403);
    }
    const sessionResult = sessionProfile as { ok?: boolean; error?: string; profile?: { id?: string; name?: string; email?: string; role?: string } };
    if (!sessionResult?.ok || !sessionResult.profile?.id) {
      return jsonResponse({ ok: false, error: sessionResult?.error ?? "Invalid session" }, 403);
    }

    const { data: access, error: accessErr } = await supabase
      .from("field_tools_profiles")
      .select("role, modules")
      .eq("id", callerId)
      .maybeSingle();
    if (accessErr) return jsonResponse({ ok: false, error: accessErr.message }, 500);
    const role = String(access?.role ?? sessionResult.profile.role ?? "");
    const modules = Array.isArray(access?.modules) ? access.modules.map(String) : [];
    if (role !== "admin" && !modules.includes("reimbursements")) {
      return jsonResponse({ ok: false, error: "You do not have Reimbursements." }, 403);
    }

    const parsed = linesFromBody(body.lines);
    if ("error" in parsed) return jsonResponse({ ok: false, error: parsed.error }, 400);
    const { data: codeRows, error: codeErr } = await supabase
      .from("field_tools_reimbursement_cost_codes")
      .select("code");
    if (codeErr) return jsonResponse({ ok: false, error: codeErr.message }, 500);
    const allowedCodes = new Map(
      (codeRows ?? []).map((row) => [String(row.code ?? "").trim().toLowerCase(), String(row.code ?? "").trim()]),
    );
    for (const line of parsed.lines) {
      const canonical = allowedCodes.get(line.cost_code.trim().toLowerCase());
      if (!canonical) return jsonResponse({ ok: false, error: "Choose a cost code from the list." }, 400);
      line.cost_code = canonical;
    }
    const employeeSignature = strField(body.employee_signature);
    if (!isSignature(employeeSignature)) {
      return jsonResponse({ ok: false, error: "The employee signature is required." }, 400);
    }
    const pdfBase64 = normalizePdfBase64(strField(body.pdf_base64));
    if (!isPdfBase64(pdfBase64)) {
      return jsonResponse({ ok: false, error: "The form is too large to email. Remove a receipt or send fewer expenses." }, 400);
    }
    const clientSubmitId = asUuid(body.client_submit_id);
    if (!clientSubmitId) return jsonResponse({ ok: false, error: "Could not save this request. Start it again." }, 400);

    const submittedDate = strField(body.date_submitted);
    const submittedDay = utcDay(submittedDate);
    const now = new Date();
    const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (submittedDay == null || Math.abs(submittedDay - utcToday) > 2 * 86_400_000) {
      return jsonResponse({ ok: false, error: "Date submitted is not valid." }, 400);
    }
    const supervisorName = "";

    const requestedEmployeeId = asUuid(body.employee_profile_id);
    if (role === "laborer" && requestedEmployeeId && requestedEmployeeId !== callerId) {
      return jsonResponse({ ok: false, error: "You can only file your own reimbursement." }, 403);
    }
    let employeeProfileId = role === "laborer" ? callerId : requestedEmployeeId;
    let employeeName = cleanText(body.employee_name, 120);
    let employeeEmail = "";
    if (employeeProfileId) {
      const { data: employee, error: employeeErr } = await supabase
        .from("field_tools_profiles")
        .select("id, name, email, person_id, active")
        .eq("id", employeeProfileId)
        .maybeSingle();
      if (employeeErr) return jsonResponse({ ok: false, error: employeeErr.message }, 500);
      if (!employee?.active) return jsonResponse({ ok: false, error: "That employee is not active." }, 400);
      employeeName = cleanText(employee.name, 120);
      employeeEmail = strField(employee.email).toLowerCase();
      if (employee.person_id) {
        const { data: person } = await supabase.from("org_people").select("name, email, active").eq("id", employee.person_id).maybeSingle();
        if (person?.active) {
          employeeName = cleanText(person.name, 120) || employeeName;
          employeeEmail = strField(person.email).toLowerCase() || employeeEmail;
        }
      }
    }
    if (!employeeName) return jsonResponse({ ok: false, error: "Enter who this reimbursement is for." }, 400);
    const { data: mail } = await supabase.from("field_tools_reimbursement_mail").select("to_email").eq("id", 1).maybeSingle();
    const addresses = parseEmailList(String(mail?.to_email ?? ""));
    if (!addresses.length) return jsonResponse({ ok: true, emailed: false, reason: "no_address" });

    const totalCents = parsed.lines.reduce((sum, line) => sum + line.cents, 0);
    const storedLines = parsed.lines.map((line) => ({
      expense_date: line.expense_date,
      description: line.description,
      amount: line.amount,
      job_number: line.job_number,
      job_name: line.job_name,
      cost_code: line.cost_code,
    }));
    const row = {
      client_submit_id: clientSubmitId,
      employee_profile_id: employeeProfileId || null,
      employee_name: employeeName,
      employee_email: employeeEmail,
      submitted_by_profile_id: callerId,
      submitted_by_name: cleanText(sessionResult.profile.name, 120) || "Field",
      submitted_by_email: strField(sessionResult.profile.email).toLowerCase(),
      supervisor_name: supervisorName,
      date_submitted: submittedDate,
      total_amount: Number((totalCents / 100).toFixed(2)),
      lines: storedLines,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("field_tools_reimbursements")
      .select("id, email_status, submitted_by_profile_id, emailed_to, cc_emails")
      .eq("client_submit_id", clientSubmitId)
      .maybeSingle();
    if (existing && existing.submitted_by_profile_id !== callerId && role !== "admin" && role !== "super") {
      return jsonResponse({ ok: false, error: "Access denied" }, 403);
    }
    if (existing?.email_status === "sent") {
      return jsonResponse({
        ok: true,
        emailed: true,
        already: true,
        id: existing.id,
        to: existing.emailed_to ?? addresses[0],
        cc: existing.cc_emails ?? "",
      });
    }

    let requestId = existing?.id as string | undefined;
    if (requestId) {
      const { error: updateErr } = await supabase.from("field_tools_reimbursements").update({ ...row, email_status: "pending", email_error: "" }).eq("id", requestId);
      if (updateErr) return jsonResponse({ ok: false, error: updateErr.message }, 500);
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("field_tools_reimbursements")
        .insert({ ...row, email_status: "pending" })
        .select("id")
        .single();
      if (insertErr?.code === "23505") {
        const { data: raced } = await supabase.from("field_tools_reimbursements").select("id, email_status, emailed_to, cc_emails").eq("client_submit_id", clientSubmitId).maybeSingle();
        if (raced?.email_status === "sent") {
          return jsonResponse({ ok: true, emailed: true, already: true, id: raced.id, to: raced.emailed_to ?? "", cc: raced.cc_emails ?? "" });
        }
        requestId = raced?.id as string | undefined;
      } else if (insertErr || !inserted) {
        return jsonResponse({ ok: false, error: insertErr?.message ?? "Could not save the request." }, 500);
      } else {
        requestId = inserted.id as string;
      }
    }
    if (!requestId) return jsonResponse({ ok: false, error: "Could not save the request." }, 500);

    const to = addresses[0]!;
    const cc = new Set(addresses.slice(1).filter((email) => email !== to));
    for (const email of [employeeEmail, row.submitted_by_email]) {
      const valid = parseEmailList(email)[0];
      if (valid && valid !== to) cc.add(valid);
    }
    const ccList = [...cc].join(", ");
    const subject = `Reimbursement — ${employeeName} — ${formatMoney(totalCents)} — ${formatFormDate(submittedDate)}`.slice(0, 200);
    const text = [
      "REIMBURSEMENT REQUEST",
      `${employeeName}`,
      `Date submitted: ${formatFormDate(submittedDate)}`,
      "Supervisor signature: left blank for the office.",
      `Submitted by: ${row.submitted_by_name}`,
      "",
      ...parsed.lines.map(
        (line, index) =>
          `${index + 1}. ${formatFormDate(line.expense_date)}  ${line.description}  ${formatMoney(line.cents)}  Job ${line.job_number}  Cost code ${line.cost_code}`,
      ),
      "",
      `TOTAL ${formatMoney(totalCents)}`,
      "",
      "The form is attached. Receipt photos are on the pages after the form. GL account and cost type are blank for the office.",
    ].join("\n");
    const html = `<pre style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.4;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>`;
    const sent = await sendJobFlowNotification({
      to,
      cc: ccList,
      subject,
      htmlBody: html,
      text,
      attachmentName: fileName(employeeName, submittedDate),
      attachmentBase64: pdfBase64,
      jobFlowOnly: true,
    });
    if (!sent.ok) {
      await supabase.from("field_tools_reimbursements").update({ email_status: "failed", emailed_to: to, cc_emails: ccList, email_error: sent.message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", requestId);
      return jsonResponse({ ok: true, emailed: false, reason: "email_failed", id: requestId, to, error: sent.message.slice(0, 300) });
    }
    await supabase.from("field_tools_reimbursements").update({ email_status: "sent", emailed_to: to, cc_emails: ccList, email_error: "", updated_at: new Date().toISOString() }).eq("id", requestId);
    return jsonResponse({ ok: true, emailed: true, id: requestId, to, cc: ccList });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not email the form.";
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
