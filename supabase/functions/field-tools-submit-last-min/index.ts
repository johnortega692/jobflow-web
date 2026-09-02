import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "field-tools-receipts";
const MAX_BYTES = 1_500_000;

type Body = {
  caller_id?: string;
  session_token?: string;
  client_submit_id?: string;
  job_number?: string;
  job_name?: string;
  project_id?: string;
  store_name?: string;
  amount?: string;
  notes?: string;
  image_base64?: string;
};

type SessionProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

function isIcbiGcFlag(value: unknown): boolean {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

function sanitizeAttachmentPart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

function decodeJpegBase64(raw: string): Uint8Array | null {
  const cleaned = raw.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").replace(/\s/g, "");
  if (!cleaned) return null;
  try {
    const bin = atob(cleaned);
    if (bin.length < 32 || bin.length > MAX_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asUuid(value: unknown): string {
  const s = strField(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : "";
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function parseJobCodeList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((code) => code.trim().split(/\s+/)[0]?.toUpperCase() ?? "")
    .filter(Boolean);
}

function jobCodeKey(jobNumber: string): string {
  return jobNumber.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function ccJoin(emails: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = (raw ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out.join(",");
}

function contactsFromJobInfo(ji: Record<string, unknown>): {
  pm: string;
  pmEmail: string;
  superName: string;
  superEmail: string;
  isGc: boolean;
} {
  return {
    pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
    pmEmail: strField(ji.icbi_pm_email),
    superName: strField(ji.field_request_super) || strField(ji.icbi_super),
    superEmail: strField(ji.icbi_super_email),
    isGc: isIcbiGcFlag(ji.icbi_is_gc),
  };
}

async function loadJobContacts(
  supabase: ReturnType<typeof createClient>,
  jobCode: string,
  jobName: string,
  projectId: string,
): Promise<{ pm: string; pmEmail: string; superName: string; superEmail: string; isGc: boolean }> {
  const empty = { pm: "", pmEmail: "", superName: "", superEmail: "", isGc: false };
  if (projectId) {
    const { data } = await supabase.from("projects").select("data").eq("id", projectId).maybeSingle();
    if (data) return contactsFromJobInfo(jobInfoFromProjectData(data.data));
  }

  const { data } = await supabase
    .from("projects")
    .select("id, job_number, job_name, data")
    .ilike("job_number", jobCode);
  const rows = (data ?? []) as { job_number: string; job_name: string | null; data: unknown }[];
  if (!rows.length) return empty;

  const code = jobCode.trim().toLowerCase();
  const name = jobName.trim().toLowerCase();
  const exact = rows.filter((r) => strField(r.job_number).toLowerCase() === code);
  const pool = exact.length ? exact : rows;
  const named = name ? pool.find((r) => strField(r.job_name).toLowerCase() === name) : undefined;
  const picked = named ?? pool[0];
  if (!picked) return empty;
  return contactsFromJobInfo(jobInfoFromProjectData(picked.data));
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
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { success?: boolean; error?: string; message?: string };
    if (!res.ok || data.success === false) {
      return { ok: false, message: data.error ?? data.message ?? `GAS HTTP ${res.status}` };
    }
    return { ok: true, message: data.message ?? "Email sent" };
  } catch {
    // Apps Script often sends the mail, then returns an HTML wrapper instead of JSON.
    if (res.ok) return { ok: true, message: "Email sent" };
    const msg = text.trim().startsWith("<") ? "Email service was busy" : text.trim().slice(0, 240);
    return { ok: false, message: msg || `GAS HTTP ${res.status}` };
  }
}

function lastMinEmailHtml(opts: {
  companyName: string;
  jobLabel: string;
  poNumber: string;
  storeName: string;
  amount: string;
  notes: string;
  uploadedBy: string;
  pm: string;
  superName: string;
}): string {
  const lines = [
    `<p><strong>PO Number:</strong> ${escapeHtml(opts.poNumber)}</p>`,
    `<p><strong>Project:</strong> ${escapeHtml(opts.jobLabel)}</p>`,
    opts.pm ? `<p><strong>PM:</strong> ${escapeHtml(opts.pm)}</p>` : "",
    opts.superName ? `<p><strong>Superintendent:</strong> ${escapeHtml(opts.superName)}</p>` : "",
    opts.storeName ? `<p><strong>Store:</strong> ${escapeHtml(opts.storeName)}</p>` : "",
    opts.amount ? `<p><strong>Amount:</strong> ${escapeHtml(opts.amount)}</p>` : "",
    `<p><strong>Uploaded by:</strong> ${escapeHtml(opts.uploadedBy)}</p>`,
    opts.notes ? `<p><strong>Notes:</strong> ${escapeHtml(opts.notes)}</p>` : "",
    "<p>This was a last-minute walk-in. The vendor was not emailed. A receipt photo is attached.</p>",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <h2 style="margin:0 0 12px;color:#1a3a5c;">Last-Min receipt</h2>
  ${lines}
  <p style="color:#666;font-size:13px;">${escapeHtml(opts.companyName)}</p>
</body>
</html>`;
}

async function callerCanAccessJob(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  jobCode: string,
): Promise<boolean> {
  const { data: accessProfile } = await supabase
    .from("field_tools_profiles")
    .select("job_access")
    .eq("id", profileId)
    .maybeSingle();
  if (String(accessProfile?.job_access ?? "all") === "all") return true;

  const { data: links } = await supabase
    .from("field_tools_project_access")
    .select("project_id")
    .eq("profile_id", profileId);
  const projectIds = (links ?? []).map((row) => String((row as { project_id: string }).project_id));
  if (!projectIds.length) return false;
  const { data: jobs } = await supabase.from("projects").select("job_number").in("id", projectIds);
  return (jobs ?? []).some(
    (row) => String((row as { job_number?: string }).job_number ?? "").trim().toLowerCase() === jobCode.toLowerCase(),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const companyName = Deno.env.get("COMPANY_NAME")?.trim() || "Ironwood Commercial Builders";
    const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || companyName;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as Body;
    const callerId = body?.caller_id?.trim();
    const sessionToken = body?.session_token?.trim();
    if (!callerId || !sessionToken) {
      return jsonResponse({ ok: false, error: "caller_id and session_token are required" }, 401);
    }

    const jobCode = strField(body.job_number);
    const jobName = strField(body.job_name);
    const projectId = strField(body.project_id);
    const storeName = strField(body.store_name);
    const amount = strField(body.amount);
    const notes = strField(body.notes);
    const clientSubmitId = asUuid(body.client_submit_id);
    const jpeg = decodeJpegBase64(body.image_base64 ?? "");

    if (!jobCode) return jsonResponse({ ok: false, error: "Select a project." }, 400);
    if (!jpeg) {
      return jsonResponse({ ok: false, error: "A receipt photo is required." }, 400);
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
      profile?: SessionProfile;
    };
    if (!profileResult?.ok || !profileResult.profile) {
      return jsonResponse({ ok: false, error: profileResult?.error ?? "Invalid session" }, 403);
    }
    const profile = profileResult.profile;

    const { data: hidden } = await supabase.rpc("field_tools_job_number_hidden", { p_job_number: jobCode });
    if (hidden === true) {
      return jsonResponse({ ok: false, error: "You don't have access to this job." }, 403);
    }
    if (!(await callerCanAccessJob(supabase, profile.id, jobCode))) {
      return jsonResponse({ ok: false, error: "You don't have access to this job." }, 403);
    }

    if (clientSubmitId) {
      const { data: existing } = await supabase
        .from("field_tools_orders")
        .select("id, po_number, submitted_by_profile_id")
        .eq("client_submit_id", clientSubmitId)
        .maybeSingle();
      if (existing) {
        if (existing.submitted_by_profile_id !== profile.id && profile.role !== "admin" && profile.role !== "super") {
          return jsonResponse({ ok: false, error: "Access denied" }, 403);
        }
        return jsonResponse({
          ok: true,
          order_id: existing.id,
          po_number: existing.po_number || null,
          message: existing.po_number ? `Already submitted — PO# ${existing.po_number}` : "Already submitted",
        });
      }
    }

    const { pm, pmEmail, superName, superEmail, isGc } = await loadJobContacts(
      supabase,
      jobCode,
      jobName,
      projectId,
    );
    const { data: orderSettings } = await supabase
      .from("field_tools_order_settings")
      .select("global_cc_emails, global_cc_skip_job_codes")
      .eq("id", 1)
      .maybeSingle();
    const skipAlwaysCc = parseJobCodeList(String(orderSettings?.global_cc_skip_job_codes ?? "")).includes(
      jobCodeKey(jobCode),
    );
    const alwaysCc = skipAlwaysCc ? [] : parseEmailList(String(orderSettings?.global_cc_emails ?? ""));
    const { data: po, error: poErr } = await supabase.rpc("field_tools_next_po_number", { p_job_code: jobCode });
    if (poErr) return jsonResponse({ ok: false, error: poErr.message }, 500);
    let poNumber = String(po ?? "").trim();
    if (!poNumber) return jsonResponse({ ok: false, error: "Could not assign a PO number." }, 500);
    if (isGc && !poNumber.endsWith("P")) poNumber = `${poNumber}P`;

    const payload = {
      lastMin: true,
      projectId,
      storeName,
      amount,
      notes,
      pm,
      pmEmail,
      super: superName,
      superEmail,
    };

    const { data: orderRow, error: insertErr } = await supabase
      .from("field_tools_orders")
      .insert({
        job_number: jobCode,
        job_name: jobName,
        order_type: "last_min",
        submitted_by_profile_id: profile.id,
        submitted_by_name: profile.name,
        submitted_by_email: profile.email,
        site_contact: "",
        notes,
        delivery_type: "willCall",
        date_needed: null,
        crew_kit: "",
        crew_count: 1,
        phase: "",
        payload,
        paint: [],
        materials: [],
        scopes: [],
        po_number: poNumber,
        status: "confirmed",
        email_status: "pending",
        client_submit_id: clientSubmitId || null,
        dispatch_specs: [{ type: "last_min", assign_po: true, vendor_name: storeName }],
      })
      .select("id")
      .single();

    if (insertErr?.code === "23505" && clientSubmitId) {
      const { data: raced } = await supabase
        .from("field_tools_orders")
        .select("id, po_number")
        .eq("client_submit_id", clientSubmitId)
        .maybeSingle();
      if (raced) {
        return jsonResponse({
          ok: true,
          order_id: raced.id,
          po_number: raced.po_number || poNumber,
          message: `Already submitted — PO# ${raced.po_number || poNumber}`,
        });
      }
    }
    if (insertErr || !orderRow) {
      return jsonResponse({ ok: false, error: insertErr?.message ?? "Order insert failed" }, 500);
    }

    const orderId = orderRow.id as string;
    const jobLabel = [jobCode, jobName].filter(Boolean).join(" ");
    const subject = `Last-Min receipt — ${jobLabel} — PO# ${poNumber}`;
    const toEmail = pmEmail || superEmail || alwaysCc[0] || profile.email;
    const ccEmails = ccJoin([
      profile.email,
      superEmail,
      ...alwaysCc,
      pmEmail,
    ].filter((email) => email.trim().toLowerCase() !== toEmail.trim().toLowerCase()));

    let emailStatus = "skipped";
    let emailedTo = "";
    let emailedAt: string | null = null;
    let emailError = "";
    let gasResponse: Record<string, unknown> = {};

    if (!toEmail) {
      emailError = "No PM, super, or team email on this job";
      gasResponse = { skipped: true, error: emailError };
    } else {
      const mailed = await sendGasEmail({
        to: toEmail,
        cc: ccEmails,
        subject,
        htmlBody: lastMinEmailHtml({
          companyName,
          jobLabel,
          poNumber,
          storeName,
          amount,
          notes,
          uploadedBy: profile.name,
          pm,
          superName,
        }),
        attachmentName: `${sanitizeAttachmentPart(jobCode) || "order"} PO-${sanitizeAttachmentPart(poNumber)} receipt.jpg`,
        attachmentBase64: bytesToBase64(jpeg),
        senderName,
      });
      if (mailed.ok) {
        emailStatus = "sent";
        emailedTo = toEmail;
        emailedAt = new Date().toISOString();
        gasResponse = { ok: true };
      } else {
        emailStatus = "failed";
        emailedTo = toEmail;
        emailError = mailed.message;
        gasResponse = { error: mailed.message };
      }
    }

    await supabase.from("field_tools_order_dispatches").insert({
      order_id: orderId,
      dispatch_type: "last_min",
      po_number: poNumber,
      to_email: emailedTo,
      cc_emails: ccEmails,
      subject,
      email_status: emailStatus,
      gas_response: gasResponse,
      emailed_at: emailedAt,
    });

    const receiptId = crypto.randomUUID();
    const storagePath = `${orderId}/${receiptId}.jpg`;
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, jpeg, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (!uploadErr) {
      await supabase.from("field_tools_order_receipts").insert({
        id: receiptId,
        order_id: orderId,
        storage_path: storagePath,
        mime_type: "image/jpeg",
        byte_size: jpeg.byteLength,
        uploaded_by_profile_id: profile.id,
        uploaded_by_name: profile.name,
        emailed_to: emailedTo,
        emailed_at: emailedAt,
        email_status: emailStatus,
        email_error: emailError,
      });
    }

    const orderEmailStatus = emailStatus === "failed" ? "failed" : "sent";
    await supabase
      .from("field_tools_orders")
      .update({
        email_status: orderEmailStatus,
        last_submit_error: uploadErr?.message || (emailStatus === "failed" ? emailError : ""),
      })
      .eq("id", orderId);

    let message = `Last-Min submitted — PO# ${poNumber}`;
    if (emailStatus === "sent") message += ". Receipt emailed to the PM (super and Always CC copied, not the vendor).";
    else if (emailStatus === "skipped") message += ". Saved with no PM email on this job.";
    else message += `. Saved, but the PM email did not send. ${emailError}`;
    if (uploadErr) message += ` Receipt file did not save: ${uploadErr.message}`;

    return jsonResponse({
      ok: true,
      order_id: orderId,
      po_number: poNumber,
      message,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Submit failed" }, 500);
  }
});
