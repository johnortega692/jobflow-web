import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { embedLogoUrlInHtml, loadOrderBranding } from "../field-tools-submit-order/branding.ts";
import { formatOrderDateTime } from "../field-tools-submit-order/dates.ts";
import { buildTailgateEmailHtml } from "./email-html.ts";
import { buildTailgatePdf, bytesToBase64, type TailgateAttendee } from "./pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function sanitizeAttachmentPart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

function gasErrorMessage(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) return `Email service HTTP ${status}`;
  if (trimmed.startsWith("<") || /unable to open the file/i.test(trimmed) || /page not found/i.test(trimmed)) {
    return "Email service was busy. The meeting is saved — check inbox or submit again if it did not arrive.";
  }
  return trimmed.slice(0, 240);
}

async function postGasEmail(url: string, params: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { success?: boolean; error?: string; message?: string };
    if (!res.ok || data.success === false) {
      return { ok: false, message: data.error ?? data.message ?? `Email service HTTP ${res.status}` };
    }
    return { ok: true, message: data.message ?? "Email sent" };
  } catch {
    return { ok: false, message: gasErrorMessage(text, res.status) };
  }
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
  let result = await postGasEmail(url, params);
  if (!result.ok && /busy|HTTP 5|unable/i.test(result.message)) {
    await new Promise((r) => setTimeout(r, 800));
    result = await postGasEmail(url, params);
  }
  return result;
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

    const supabase = createClient(supabaseUrl, serviceKey);
    const branding = await loadOrderBranding(supabase, companyName);

    const body = (await req.json()) as { caller_id?: string; session_token?: string; meeting_id?: string };
    const callerId = body?.caller_id?.trim();
    const sessionToken = body?.session_token?.trim();
    const meetingId = body?.meeting_id?.trim();
    if (!callerId || !sessionToken || !meetingId) {
      return jsonResponse({ ok: false, error: "caller_id, session_token, and meeting_id are required" }, 400);
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
    const profileResult = sessionProfile as { ok?: boolean; error?: string };
    if (!profileResult?.ok) {
      return jsonResponse({ ok: false, error: profileResult?.error ?? "Invalid session" }, 403);
    }

    const { data: packet, error: packetErr } = await supabase.rpc("field_tools_tailgate_meeting_packet", {
      p_meeting_id: meetingId,
    });
    if (packetErr) {
      return jsonResponse({ ok: false, error: packetErr.message }, 500);
    }
    const pack = packet as {
      ok?: boolean;
      error?: string;
      meeting?: {
        job_number: string;
        job_name: string;
        submitted_by_name: string;
        submitted_by_email: string;
        attendees: TailgateAttendee[];
        notes: string;
        completed_at: string;
      };
      topic?: {
        title: string;
        body_text: string;
        image_mime: string;
        image_base64: string | null;
        pdf_base64: string | null;
      };
      settings?: { to_email: string; cc_emails: string };
    };
    if (!pack?.ok || !pack.meeting || !pack.topic) {
      return jsonResponse({ ok: false, error: pack?.error ?? "Meeting not found" }, 404);
    }

    const to = (pack.settings?.to_email ?? "").trim();
    if (!to) {
      await supabase
        .from("field_tools_tailgate_meetings")
        .update({ email_status: "skipped", email_error: null })
        .eq("id", meetingId);
      return jsonResponse({ ok: true, message: "Saved without email (no To address set)" });
    }

    const completedAt = pack.meeting.completed_at
      ? formatOrderDateTime(new Date(pack.meeting.completed_at))
      : formatOrderDateTime();
    const attendees = Array.isArray(pack.meeting.attendees) ? pack.meeting.attendees : [];
    const names = attendees.map((a) => String(a.name ?? "").trim()).filter(Boolean);
    const jobLabel = [pack.meeting.job_number, pack.meeting.job_name].filter(Boolean).join(" ");

    const pdfBytes = await buildTailgatePdf({
      branding,
      title: pack.topic.title,
      bodyText: pack.topic.body_text ?? "",
      jobCode: pack.meeting.job_number,
      jobName: pack.meeting.job_name,
      conductedBy: pack.meeting.submitted_by_name,
      completedAt,
      notes: pack.meeting.notes ?? "",
      attendees,
      topicImageBase64: pack.topic.image_base64,
      topicImageMime: pack.topic.image_mime,
      topicPdfBase64: pack.topic.pdf_base64,
    });

    let html = buildTailgateEmailHtml({
      branding,
      title: pack.topic.title,
      jobLabel,
      conductedBy: pack.meeting.submitted_by_name,
      completedAt,
      names,
      notes: pack.meeting.notes ?? "",
    });
    html = await embedLogoUrlInHtml(html, branding.logoUrl);

    const cc = [
      ...parseEmailList(pack.settings?.cc_emails ?? ""),
      ...parseEmailList(pack.meeting.submitted_by_email ?? ""),
    ]
      .filter((e, i, arr) => e && e !== to.toLowerCase() && arr.indexOf(e) === i)
      .join(",");

    const attachmentName = `${sanitizeAttachmentPart(pack.meeting.job_number) || "Job"} ${sanitizeAttachmentPart(pack.topic.title) || "Tailgate"}.pdf`;
    const sent = await sendGasEmail({
      to,
      cc,
      subject: `Safety Tailgate — ${jobLabel || pack.topic.title}`,
      htmlBody: html,
      attachmentName,
      attachmentBase64: bytesToBase64(pdfBytes),
      senderName,
    });

    await supabase
      .from("field_tools_tailgate_meetings")
      .update({
        email_status: sent.ok ? "sent" : "failed",
        email_error: sent.ok ? null : gasErrorMessage(sent.message, 502),
      })
      .eq("id", meetingId);

    if (!sent.ok) {
      return jsonResponse({ ok: false, error: sent.message });
    }
    return jsonResponse({ ok: true, message: sent.message });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tailgate email failed";
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
