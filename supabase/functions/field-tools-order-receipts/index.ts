import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Orders placed before this instant do not require a receipt photo. Keep in sync with field-tools receiptStatus.ts. */
const RECEIPT_REQUIRED_FROM = "2026-10-24T15:30:00.000Z";

const BUCKET = "field-tools-receipts";
const MAX_RECEIPTS = 8;
const MAX_BYTES = 1_500_000;
const SIGNED_TTL_SEC = 60 * 60;

const TEST_RECIPIENT = "johnortega@gmail.com";

type Body = {
  action?: string;
  caller_id?: string;
  session_token?: string;
  order_id?: string;
  image_base64?: string;
  secret?: string;
  /** send_test only. Any other address is refused. */
  to?: string;
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
  order_type?: string;
  payload: Record<string, unknown> | null;
  submitted_by_profile_id: string | null;
  submitted_by_name?: string | null;
  submitted_by_email?: string | null;
  receipt_reminder_sent_at?: string | null;
  receipt_reminder_count?: number | null;
  created_at?: string | null;
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

type ReceiptReminderSettings = {
  enabled: boolean;
  onSubmit: boolean;
  followup: boolean;
  maxCount: number;
  ccPm: boolean;
};

async function loadReceiptReminderSettings(
  supabase: ReturnType<typeof createClient>,
): Promise<ReceiptReminderSettings> {
  const { data } = await supabase
    .from("field_tools_order_settings")
    .select(
      "receipt_reminder_enabled, receipt_reminder_on_submit, receipt_reminder_followup, receipt_reminder_max_count, receipt_reminder_cc_pm",
    )
    .eq("id", 1)
    .maybeSingle();
  const row = data as {
    receipt_reminder_enabled?: boolean | null;
    receipt_reminder_on_submit?: boolean | null;
    receipt_reminder_followup?: boolean | null;
    receipt_reminder_max_count?: number | null;
    receipt_reminder_cc_pm?: boolean | null;
  } | null;
  return {
    enabled: row?.receipt_reminder_enabled !== false,
    onSubmit: row?.receipt_reminder_on_submit !== false,
    followup: row?.receipt_reminder_followup !== false,
    maxCount: Math.min(5, Math.max(1, Number(row?.receipt_reminder_max_count) || 2)),
    ccPm: row?.receipt_reminder_cc_pm !== false,
  };
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

type OfficeContacts = { pm: string; pmEmail: string; superName: string; superEmail: string };

function contactsFromJobInfo(ji: Record<string, unknown>): OfficeContacts {
  return {
    pm: strField(ji.icbi_pm) || strField(ji.field_request_pm),
    pmEmail: strField(ji.icbi_pm_email),
    superName: strField(ji.field_request_super) || strField(ji.icbi_super),
    superEmail: strField(ji.icbi_super_email),
  };
}

const emptyContacts: OfficeContacts = { pm: "", pmEmail: "", superName: "", superEmail: "" };

async function loadPmEmail(
  supabase: ReturnType<typeof createClient>,
  jobCode: string,
  jobName: string,
  projectId: string,
): Promise<OfficeContacts> {
  if (projectId) {
    const { data } = await supabase.from("projects").select("data").eq("id", projectId).maybeSingle();
    if (data) return contactsFromJobInfo(jobInfoFromProjectData(data.data));
  }

  const { data } = await supabase
    .from("projects")
    .select("id, job_number, job_name, data")
    .ilike("job_number", jobCode);
  const rows = (data ?? []) as { job_number: string; job_name: string | null; data: unknown }[];
  if (!rows.length) return emptyContacts;

  const code = jobCode.trim().toLowerCase();
  const name = jobName.trim().toLowerCase();
  const exact = rows.filter((r) => strField(r.job_number).toLowerCase() === code);
  const pool = exact.length ? exact : rows;
  const named = name ? pool.find((r) => strField(r.job_name).toLowerCase() === name) : undefined;
  const picked = named ?? pool[0];
  if (!picked) return emptyContacts;
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

type DigestLine = { poNumber: string; jobLabel: string; ordered: string };

function pacificToday(): { friday: boolean; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    friday: part("weekday") === "Fri",
    date: `${part("year")}-${part("month")}-${part("day")}`,
  };
}

function formatOrdered(iso: string | null | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(time));
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function pdfText(value: string): string {
  return value
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}

function clipPdf(value: string, max = 88): string {
  const clean = pdfText(value).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function receiptDigestHtml(opts: {
  companyName: string;
  ordererName: string;
  lines: DigestLine[];
  banner?: string;
}): string {
  const rows = opts.lines
    .map(
      (line) =>
        `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6;">${escapeHtml(line.poNumber || "—")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6;">${escapeHtml(line.jobLabel)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e6e6e6;">${escapeHtml(line.ordered || "—")}</td>
        </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <h2 style="margin:0 0 12px;color:#1a3a5c;">Receipts still needed</h2>
  ${opts.banner ? `<p style="margin:0 0 12px;padding:8px 10px;background:#fff6d8;border:1px solid #e6d48a;">${escapeHtml(opts.banner)}</p>` : ""}
  <p>Hi ${escapeHtml(opts.ordererName || "there")},</p>
  <p>These orders still need a receipt photo. The photo confirms the order was received and the items are correct. Open <strong>Ordering → Order History</strong>, open the order, and add the photo.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #1a3a5c;">PO</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #1a3a5c;">Project</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #1a3a5c;">Ordered</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#666;font-size:13px;">${escapeHtml(opts.companyName)}</p>
</body>
</html>`;
}

async function buildDigestPdf(name: string, lines: DigestLine[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  const nextPage = () => {
    page = doc.addPage([612, 792]);
    y = 740;
  };
  page.drawText("Receipts still needed", { x: 48, y, size: 18, font: bold });
  y -= 28;
  page.drawText(clipPdf(`Hi ${name || "there"},`), { x: 48, y, size: 12, font });
  y -= 20;
  page.drawText("The photo confirms the order was received and the items are correct.", { x: 48, y, size: 11, font });
  y -= 16;
  page.drawText("Open Ordering > Order History, open the order, and add the photo.", { x: 48, y, size: 11, font });
  y -= 26;
  for (const line of lines) {
    if (y < 72) nextPage();
    const label = [line.poNumber || "No PO", line.jobLabel, line.ordered].filter(Boolean).join("  ·  ");
    page.drawText(clipPdf(label), { x: 48, y, size: 11, font });
    y -= 18;
  }
  return doc.save();
}

function ccJoin(emails: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = (raw ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out.join(",");
}

async function sendReceiptDigest(
  supabase: ReturnType<typeof createClient>,
  orders: OrderRow[],
  opts: { companyName: string; senderName: string; secret: string; sentOn: string },
): Promise<{ ok: boolean; message: string; skipped?: boolean }> {
  const to = (orders[0]?.submitted_by_email ?? "").trim();
  if (!isEmail(to)) return { ok: false, message: "No email on file for the person who ordered" };

  const { data: claim, error: claimErr } = await supabase.rpc("field_tools_receipt_digest_claim", {
    p_secret: opts.secret,
    p_sent_on: opts.sentOn,
    p_email: to,
  });
  if (claimErr) return { ok: false, message: claimErr.message };
  const claimed = claim as { ok?: boolean; claimed?: boolean; error?: string } | null;
  if (!claimed?.ok) return { ok: false, message: claimed?.error ?? "Could not reserve that digest." };
  if (claimed.claimed !== true) return { ok: true, message: "Already sent today", skipped: true };

  const contacts = new Map<string, OfficeContacts>();
  const lines: DigestLine[] = [];
  const ccEmails: string[] = [];
  let ordererName = "";
  for (const order of orders) {
    if (!ordererName) ordererName = strField(order.submitted_by_name);
    const payload = order.payload ?? {};
    const projectId = strField(payload.projectId ?? payload.project_id);
    const key = `${projectId}|${order.job_number}|${order.job_name ?? ""}`;
    let office = contacts.get(key);
    if (!office) {
      office = await loadPmEmail(supabase, order.job_number, order.job_name ?? "", projectId);
      contacts.set(key, office);
    }
    if (isEmail(office.pmEmail)) ccEmails.push(office.pmEmail);
    if (isEmail(office.superEmail)) ccEmails.push(office.superEmail);
    lines.push({
      poNumber: strField(order.po_number),
      jobLabel: [order.job_number, order.job_name].filter(Boolean).join(" "),
      ordered: formatOrdered(order.created_at),
    });
  }
  const cc = ccJoin(ccEmails.filter((email) => email.toLowerCase() !== to.toLowerCase()));
  const pdf = await buildDigestPdf(ordererName, lines);
  const subject = lines.length === 1
    ? `Receipt needed — ${lines[0]?.jobLabel ?? "order"}${lines[0]?.poNumber ? ` — ${lines[0].poNumber}` : ""}`
    : `Receipts needed — ${lines.length} orders`;
  const mailed = await sendGasEmail({
    to,
    cc,
    subject,
    htmlBody: receiptDigestHtml({ companyName: opts.companyName, ordererName, lines }),
    attachmentName: "receipts-needed.pdf",
    attachmentBase64: bytesToBase64(pdf),
    senderName: opts.senderName,
  });
  if (!mailed.ok) {
    await supabase.rpc("field_tools_receipt_digest_release", {
      p_secret: opts.secret,
      p_sent_on: opts.sentOn,
      p_email: to,
    });
    return mailed;
  }
  await supabase
    .from("field_tools_orders")
    .update({ receipt_reminder_sent_at: new Date().toISOString() })
    .in("id", orders.map((order) => order.id));
  return mailed;
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
    .select(
      "id, job_number, job_name, po_number, order_type, payload, submitted_by_profile_id, submitted_by_name, submitted_by_email, receipt_reminder_sent_at, receipt_reminder_count",
    )
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

async function loadOrdersMissingReceipts(
  supabase: ReturnType<typeof createClient>,
): Promise<{ orders: OrderRow[] } | { error: string }> {
  const orders: OrderRow[] = [];
  const pageSize = 200;
  for (let from = 0; from < 800; from += pageSize) {
    const { data: rows, error: listErr } = await supabase
      .from("field_tools_orders")
      .select(
        "id, job_number, job_name, po_number, order_type, payload, submitted_by_profile_id, submitted_by_name, submitted_by_email, created_at, status",
      )
      .in("order_type", ["field_request", "job_scope_kit"])
      .in("status", ["submitted", "confirmed"])
      .gte("created_at", RECEIPT_REQUIRED_FROM)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (listErr) return { error: listErr.message };
    const batch = (rows ?? []) as OrderRow[];
    orders.push(...batch);
    if (batch.length < pageSize) break;
  }
  const withReceipt = new Set<string>();
  for (let index = 0; index < orders.length; index += 150) {
    const slice = orders.slice(index, index + 150).map((order) => order.id);
    if (!slice.length) continue;
    const { data: receiptRows, error: receiptErr } = await supabase
      .from("field_tools_order_receipts")
      .select("order_id")
      .in("order_id", slice);
    if (receiptErr) return { error: receiptErr.message };
    for (const row of receiptRows ?? []) withReceipt.add(String((row as { order_id: string }).order_id));
  }
  const hiddenJobs = new Map<string, boolean>();
  const missing: OrderRow[] = [];
  for (const order of orders) {
    if (withReceipt.has(order.id)) continue;
    const email = (order.submitted_by_email ?? "").trim();
    if (!isEmail(email)) continue;
    const jobKey = order.job_number.trim().toLowerCase();
    let hidden = hiddenJobs.get(jobKey);
    if (hidden === undefined) {
      const { data: hiddenFlag } = await supabase.rpc("field_tools_job_number_hidden", {
        p_job_number: order.job_number,
      });
      hidden = hiddenFlag === true;
      hiddenJobs.set(jobKey, hidden);
    }
    if (hidden) continue;
    missing.push(order);
  }
  return { orders: missing };
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

    if (action === "send_test" || action === "remind_missing") {
      const { data: settings } = await supabase
        .from("field_tools_link_settings")
        .select("cron_secret")
        .eq("id", 1)
        .maybeSingle();
      const expected = String(settings?.cron_secret ?? "").trim();
      if (!expected || (body.secret ?? "").trim() !== expected) {
        return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
      }

      if (action === "send_test") {
        const to = (body.to ?? "").trim().toLowerCase();
        if (to !== TEST_RECIPIENT) {
          return jsonResponse({ ok: false, error: "Test mail only goes to the test address." }, 400);
        }
        const loaded = await loadOrdersMissingReceipts(supabase);
        if ("error" in loaded) return jsonResponse({ ok: false, error: loaded.error }, 500);
        const lines: DigestLine[] = loaded.orders.map((order) => ({
          poNumber: strField(order.po_number),
          jobLabel: [order.job_number, order.job_name].filter(Boolean).join(" "),
          ordered: formatOrdered(order.created_at),
        }));
        const subject = lines.length === 1
          ? `[TEST] Receipt needed — ${lines[0]?.jobLabel ?? "order"}${lines[0]?.poNumber ? ` — ${lines[0].poNumber}` : ""}`
          : `[TEST] Receipts needed — ${lines.length} orders`;
        const banner = "Test copy for John Ortega only. Nobody else is copied. This does not count as Friday's receipt email.";
        const pdf = await buildDigestPdf("John", lines);
        const mailed = await sendGasEmail({
          to: TEST_RECIPIENT,
          cc: "",
          subject,
          htmlBody: receiptDigestHtml({
            companyName,
            ordererName: "John",
            lines,
            banner,
          }),
          attachmentName: "receipts-needed.pdf",
          attachmentBase64: bytesToBase64(pdf),
          senderName,
        });
        if (!mailed.ok) return jsonResponse({ ok: false, error: mailed.message }, 502);
        return jsonResponse({ ok: true, to: TEST_RECIPIENT, subject, orders: lines.length });
      }

      const when = pacificToday();
      if (!when.friday) {
        return jsonResponse({ ok: true, sent: 0, skipped: 0, failed: 0 });
      }
      const reminder = await loadReceiptReminderSettings(supabase);
      if (!reminder.enabled) {
        return jsonResponse({ ok: true, sent: 0, skipped: 0, failed: 0 });
      }
      const loaded = await loadOrdersMissingReceipts(supabase);
      if ("error" in loaded) return jsonResponse({ ok: false, error: loaded.error }, 500);
      const missing = loaded.orders;
      const groups = new Map<string, OrderRow[]>();
      for (const order of missing) {
        const key = (order.submitted_by_email ?? "").trim().toLowerCase();
        const list = groups.get(key) ?? [];
        list.push(order);
        groups.set(key, list);
      }
      let sent = 0;
      let skipped = 0;
      let failed = 0;
      for (const list of groups.values()) {
        const mailed = await sendReceiptDigest(supabase, list, {
          companyName,
          senderName,
          secret: expected,
          sentOn: when.date,
        });
        if (mailed.skipped) skipped += 1;
        else if (mailed.ok) sent += 1;
        else failed += 1;
      }
      return jsonResponse({ ok: true, sent, skipped, failed });
    }

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
      return jsonResponse({ ok: true, receipts, reminders_enabled: false });
    }

    if (action === "remind") {
      return jsonResponse({ ok: false, error: "Receipt reminders go out Friday morning." }, 400);
    }

    if (action !== "upload") {
      return jsonResponse({ ok: false, error: "Unknown action" }, 400);
    }

    if ((order.order_type ?? "") === "haul_off") {
      return jsonResponse({ ok: false, error: "Haul Out orders do not use receipts" }, 400);
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
