import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "field-tools-receipts";
const MAX_RECEIPTS = 8;
const MAX_BYTES = 1_500_000;
const SIGNED_TTL_SEC = 60 * 60;

type Body = {
  action?: string;
  caller_id?: string;
  session_token?: string;
  order_id?: string;
  image_base64?: string;
};

type SessionProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type OrderRow = {
  id: string;
  job_number: string;
  job_name: string | null;
  po_number: string | null;
  payload: Record<string, unknown> | null;
  submitted_by_profile_id: string | null;
};

type ReceiptRow = {
  id: string;
  order_id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  uploaded_by_name: string;
  emailed_to: string;
  emailed_at: string | null;
  email_status: string;
  created_at: string;
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

async function loadPmEmail(
  supabase: ReturnType<typeof createClient>,
  jobCode: string,
  jobName: string,
  projectId: string,
): Promise<{ pm: string; pmEmail: string }> {
  if (projectId) {
    const { data } = await supabase.from("projects").select("data").eq("id", projectId).maybeSingle();
    if (data) {
      const ji = jobInfoFromProjectData(data.data);
      return {
        pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
        pmEmail: strField(ji.icbi_pm_email),
      };
    }
  }

  const { data } = await supabase
    .from("projects")
    .select("id, job_number, job_name, data")
    .ilike("job_number", jobCode);
  const rows = (data ?? []) as { job_number: string; job_name: string | null; data: unknown }[];
  if (!rows.length) return { pm: "", pmEmail: "" };

  const code = jobCode.trim().toLowerCase();
  const name = jobName.trim().toLowerCase();
  const exact = rows.filter((r) => strField(r.job_number).toLowerCase() === code);
  const pool = exact.length ? exact : rows;
  const named = name ? pool.find((r) => strField(r.job_name).toLowerCase() === name) : undefined;
  const picked = named ?? pool[0];
  if (!picked) return { pm: "", pmEmail: "" };
  const ji = jobInfoFromProjectData(picked.data);
  return {
    pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
    pmEmail: strField(ji.icbi_pm_email),
  };
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

function receiptEmailHtml(opts: {
  companyName: string;
  jobLabel: string;
  poNumber: string;
  uploadedBy: string;
  pm: string;
}): string {
  const lines = [
    opts.poNumber ? `<p><strong>PO Number:</strong> ${escapeHtml(opts.poNumber)}</p>` : "",
    `<p><strong>Project:</strong> ${escapeHtml(opts.jobLabel)}</p>`,
    opts.pm ? `<p><strong>PM:</strong> ${escapeHtml(opts.pm)}</p>` : "",
    `<p><strong>Uploaded by:</strong> ${escapeHtml(opts.uploadedBy)}</p>`,
    "<p>A receipt photo is attached.</p>",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <h2 style="margin:0 0 12px;color:#1a3a5c;">Order receipt</h2>
  ${lines}
  <p style="color:#666;font-size:13px;">${escapeHtml(opts.companyName)}</p>
</body>
</html>`;
}

async function requireSession(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  sessionToken: string,
): Promise<{ profile: SessionProfile } | { error: string; status: number }> {
  const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
    p_caller_id: callerId,
    p_session_token: sessionToken,
  });
  if (sessionErr) {
    const msg = /SESSION|INVALID/i.test(sessionErr.message)
      ? "Invalid or expired session. Log in again."
      : sessionErr.message;
    return { error: msg, status: 403 };
  }
  const profileResult = sessionProfile as {
    ok?: boolean;
    error?: string;
    profile?: SessionProfile;
  };
  if (!profileResult?.ok || !profileResult.profile) {
    return { error: profileResult?.error ?? "Invalid session", status: 403 };
  }
  return { profile: profileResult.profile };
}

async function loadAccessibleOrder(
  supabase: ReturnType<typeof createClient>,
  profile: SessionProfile,
  orderId: string,
): Promise<{ order: OrderRow } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("field_tools_orders")
    .select("id, job_number, job_name, po_number, payload, submitted_by_profile_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Order not found", status: 404 };

  const order = data as OrderRow;
  const { data: hidden } = await supabase.rpc("field_tools_job_number_hidden", {
    p_job_number: order.job_number,
  });
  if (hidden === true) return { error: "Order not found", status: 404 };

  const isAdmin = profile.role === "admin" || profile.role === "super";
  if (!isAdmin && order.submitted_by_profile_id !== profile.id) {
    return { error: "Access denied", status: 403 };
  }
  return { order };
}

async function receiptsWithUrls(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<Array<ReceiptRow & { url: string | null }>> {
  const { data, error } = await supabase
    .from("field_tools_order_receipts")
    .select(
      "id, order_id, storage_path, mime_type, byte_size, uploaded_by_name, emailed_to, emailed_at, email_status, created_at",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ReceiptRow[];
  const out: Array<ReceiptRow & { url: string | null }> = [];
  for (const row of rows) {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_TTL_SEC);
    out.push({ ...row, url: signed.data?.signedUrl ?? null });
  }
  return out;
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
    const orderId = body?.order_id?.trim();
    const action = (body?.action ?? "list").trim().toLowerCase();

    if (!callerId || !sessionToken) {
      return jsonResponse({ ok: false, error: "caller_id and session_token are required" }, 401);
    }
    if (!orderId) {
      return jsonResponse({ ok: false, error: "order_id is required" }, 400);
    }

    const session = await requireSession(supabase, callerId, sessionToken);
    if ("error" in session) return jsonResponse({ ok: false, error: session.error }, session.status);

    const loaded = await loadAccessibleOrder(supabase, session.profile, orderId);
    if ("error" in loaded) return jsonResponse({ ok: false, error: loaded.error }, loaded.status);
    const { order } = loaded;

    if (action === "list") {
      const receipts = await receiptsWithUrls(supabase, order.id);
      return jsonResponse({ ok: true, receipts });
    }

    if (action !== "upload") {
      return jsonResponse({ ok: false, error: "Unknown action" }, 400);
    }

    const { count } = await supabase
      .from("field_tools_order_receipts")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order.id);
    if ((count ?? 0) >= MAX_RECEIPTS) {
      return jsonResponse({ ok: false, error: `Maximum ${MAX_RECEIPTS} receipts per order` }, 400);
    }

    const jpeg = decodeJpegBase64(body.image_base64 ?? "");
    if (!jpeg) {
      return jsonResponse({ ok: false, error: "Upload a JPEG photo of the receipt (under 1.5 MB)." }, 400);
    }

    const receiptId = crypto.randomUUID();
    const storagePath = `${order.id}/${receiptId}.jpg`;
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, jpeg, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadErr) {
      return jsonResponse({ ok: false, error: uploadErr.message }, 500);
    }

    const payload = order.payload ?? {};
    const projectId = strField(payload.projectId ?? payload.project_id);
    const { pm, pmEmail } = await loadPmEmail(
      supabase,
      order.job_number,
      order.job_name ?? "",
      projectId,
    );

    const jobLabel = [order.job_number, order.job_name].filter(Boolean).join(" ");
    const poNumber = strField(order.po_number);
    const attachmentName = [
      sanitizeAttachmentPart(order.job_number) || "order",
      sanitizeAttachmentPart(poNumber.replace(/^PO[-#]?\s*/i, ""))
        ? `PO-${sanitizeAttachmentPart(poNumber.replace(/^PO[-#]?\s*/i, ""))}`
        : "receipt",
      "receipt",
    ]
      .filter(Boolean)
      .join(" ") + ".jpg";

    let emailStatus = "pending";
    let emailedTo = "";
    let emailedAt: string | null = null;
    let emailError = "";

    if (!pmEmail) {
      emailStatus = "skipped";
      emailError = "No PM email on this job";
    } else {
      const mailed = await sendGasEmail({
        to: pmEmail,
        cc: session.profile.email,
        subject: `Receipt — ${jobLabel}${poNumber ? ` — ${poNumber}` : ""}`,
        htmlBody: receiptEmailHtml({
          companyName,
          jobLabel,
          poNumber,
          uploadedBy: session.profile.name,
          pm,
        }),
        attachmentName,
        attachmentBase64: bytesToBase64(jpeg),
        senderName,
      });
      if (mailed.ok) {
        emailStatus = "sent";
        emailedTo = pmEmail;
        emailedAt = new Date().toISOString();
      } else {
        emailStatus = "failed";
        emailedTo = pmEmail;
        emailError = mailed.message;
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("field_tools_order_receipts")
      .insert({
        id: receiptId,
        order_id: order.id,
        storage_path: storagePath,
        mime_type: "image/jpeg",
        byte_size: jpeg.byteLength,
        uploaded_by_profile_id: session.profile.id,
        uploaded_by_name: session.profile.name,
        emailed_to: emailedTo,
        emailed_at: emailedAt,
        email_status: emailStatus,
        email_error: emailError,
      })
      .select(
        "id, order_id, storage_path, mime_type, byte_size, uploaded_by_name, emailed_to, emailed_at, email_status, created_at",
      )
      .single();

    if (insertErr) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return jsonResponse({ ok: false, error: insertErr.message }, 500);
    }

    const signed = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_TTL_SEC);
    const receipts = await receiptsWithUrls(supabase, order.id);

    let message = "Receipt saved.";
    if (emailStatus === "sent") message = "Receipt saved and emailed to the PM.";
    else if (emailStatus === "skipped") message = "Receipt saved. This job has no PM email.";
    else if (emailStatus === "failed") message = `Receipt saved, but the PM email did not send. ${emailError}`;

    return jsonResponse({
      ok: true,
      message,
      receipt: { ...(inserted as ReceiptRow), url: signed.data?.signedUrl ?? null },
      receipts,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Upload failed" }, 500);
  }
});
