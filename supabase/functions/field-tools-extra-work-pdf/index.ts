import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildSignedEmail, companyNameFromSettings } from "../extraWorkTagEmail.ts";
import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PDF_BUCKET = "extra-work-tag-pdfs";
const MAX_PDF_CHARS = 24_000_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
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

function pdfBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emailList(value: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function recipients(linkEmail: string, submitterEmail: string): { to: string; cc: string } {
  const list = emailList(linkEmail);
  const submitter = submitterEmail.trim().toLowerCase();
  const to = list[0] ?? (isEmail(submitter) ? submitter : "");
  const cc = [...list.slice(1), ...(to && isEmail(submitter) && submitter !== to && !list.includes(submitter) ? [submitter] : [])];
  return { to, cc: cc.join(", ") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as {
      action?: string;
      caller_id?: string;
      session_token?: string;
      tag_id?: string;
      token?: string;
      pdf_base64?: string;
      email?: boolean;
      copy_emails?: string;
    };
    const action = body.action?.trim() || "save";
    const callerId = body.caller_id?.trim() ?? "";
    const sessionToken = body.session_token?.trim() ?? "";
    const tagId = body.tag_id?.trim() ?? "";
    const token = body.token?.trim() ?? "";

    let tag: {
      id: string;
      status: string;
      tag_number: string;
      job_number: string;
      job_name: string;
      tag_date: string;
      description: string;
      submitted_by_name: string;
      submitted_by_profile_id: string;
      signer_name: string;
      signed_at: string | null;
      pdf_storage_path: string;
      pdf_filename: string;
    } | null = null;
    let linkEmail = "";
    let submitterEmail = "";

    if (action === "public") {
      if (!token) return jsonResponse({ ok: false, error: "This link is no longer valid." });
      const tokenHash = await sha256Hex(token);
      const { data: link, error: linkError } = await supabase
        .from("field_tools_extra_work_links")
        .select("tag_id, sent_to_email, used_at, retired_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (linkError || !link || link.retired_at) return jsonResponse({ ok: false, error: "This link is no longer valid." });
      const usedAt = link.used_at ? new Date(link.used_at).getTime() : 0;
      if (!usedAt || Date.now() - usedAt > 30 * 60 * 1000) {
        return jsonResponse({ ok: false, error: "This link is no longer valid." });
      }
      linkEmail = String(link.sent_to_email ?? "");
      const { data } = await supabase
        .from("field_tools_extra_work_tags")
        .select("id, status, tag_number, job_number, job_name, tag_date, description, submitted_by_name, submitted_by_profile_id, signer_name, signed_at, pdf_storage_path, pdf_filename")
        .eq("id", link.tag_id)
        .maybeSingle();
      tag = data;
    } else {
      if (!callerId || !sessionToken || !tagId) {
        return jsonResponse({ ok: false, error: "Sign in again, then open the tag." });
      }
      const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
        p_caller_id: callerId,
        p_session_token: sessionToken,
      });
      if (sessionErr) return jsonResponse({ ok: false, error: "Invalid or expired session. Log in again." });
      const profileResult = sessionProfile as { ok?: boolean };
      if (!profileResult?.ok) return jsonResponse({ ok: false, error: "Invalid or expired session. Log in again." });
      const { data } = await supabase
        .from("field_tools_extra_work_tags")
        .select("id, status, tag_number, job_number, job_name, tag_date, description, submitted_by_name, submitted_by_profile_id, signer_name, signed_at, pdf_storage_path, pdf_filename")
        .eq("id", tagId)
        .maybeSingle();
      if (!data || data.submitted_by_profile_id !== callerId) {
        return jsonResponse({ ok: false, error: "That tag could not be opened." });
      }
      tag = data;
      const { data: link } = await supabase
        .from("field_tools_extra_work_links")
        .select("sent_to_email")
        .eq("tag_id", tagId)
        .is("retired_at", null)
        .neq("sent_to_email", "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      linkEmail = [String(link?.sent_to_email ?? ""), String(body.copy_emails ?? "")].filter(Boolean).join(", ");
    }

    if (!tag || (tag.status !== "signed" && tag.status !== "refused")) {
      return jsonResponse({ ok: false, error: "The PDF is available after the tag is signed." });
    }

    const { data: profile } = await supabase
      .from("field_tools_profiles")
      .select("email")
      .eq("id", tag.submitted_by_profile_id)
      .maybeSingle();
    submitterEmail = String(profile?.email ?? "");
    const copy = recipients(linkEmail, submitterEmail);
    const filename = `${tag.job_number || "Job"} Extra Work Tag ${tag.tag_number || "tag"}.pdf`.replace(/[\\/:*?"<>|]/g, "").slice(0, 180);

    if (action === "link") {
      if (!tag.pdf_storage_path) return jsonResponse({ ok: false, error: "That PDF is not saved yet." });
      const signed = await supabase.storage.from(PDF_BUCKET).createSignedUrl(tag.pdf_storage_path, 60 * 10, {
        download: tag.pdf_filename || filename,
      });
      if (signed.error || !signed.data?.signedUrl) {
        return jsonResponse({ ok: false, error: signed.error?.message || "Could not open the PDF." });
      }
      return jsonResponse({ ok: true, url: signed.data.signedUrl, filename: tag.pdf_filename || filename });
    }

    const pdfBase64 = normalizePdfBase64(body.pdf_base64 ?? "");
    if (!isPdfBase64(pdfBase64)) return jsonResponse({ ok: false, error: "The PDF could not be saved." });

    const path = `${tag.id}.pdf`;
    const pdf = pdfBytes(pdfBase64);
    const uploaded = await supabase.storage.from(PDF_BUCKET).upload(path, pdf.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploaded.error) return jsonResponse({ ok: false, error: uploaded.error.message });
    const updated = await supabase
      .from("field_tools_extra_work_tags")
      .update({ pdf_storage_path: path, pdf_filename: filename })
      .eq("id", tag.id);
    if (updated.error) return jsonResponse({ ok: false, error: updated.error.message });

    if (body.email !== true || !copy.to) {
      return jsonResponse({ ok: true, emailed: false, reason: copy.to ? "not_requested" : "no_address", pdf_path: path, to: copy.to, cc: copy.cc });
    }

    const verb = tag.status === "refused" ? "refused" : "signed";
    const { data: org } = await supabase.from("org_settings").select("settings").eq("id", 1).maybeSingle();
    const companyName = companyNameFromSettings(
      (org?.settings ?? null) as Record<string, unknown> | null,
      Deno.env.get("COMPANY_NAME")?.trim() || Deno.env.get("VITE_COMPANY_NAME")?.trim() || "",
    );
    const mail = buildSignedEmail({
      companyName,
      tagNumber: tag.tag_number || "",
      jobNumber: tag.job_number || "",
      jobName: tag.job_name || "",
      tagDate: tag.tag_date || "",
      work: tag.description || "",
      preparerName: tag.submitted_by_name || "",
      signerName: tag.signer_name || "",
      signedAt: tag.signed_at || "",
      filename,
      refused: verb === "refused",
    });
    const sent = await sendJobFlowNotification({
      to: copy.to,
      cc: copy.cc,
      subject: mail.subject,
      htmlBody: mail.html,
      text: mail.text,
      fromName: companyName,
      attachmentName: filename,
      attachmentBase64: pdfBase64,
      jobFlowOnly: true,
    });
    if (!sent.ok) {
      return jsonResponse({ ok: true, emailed: false, reason: "send_failed", error: sent.message, pdf_path: path, to: copy.to, cc: copy.cc });
    }
    return jsonResponse({ ok: true, emailed: true, pdf_path: path, to: copy.to, cc: copy.cc });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the PDF.";
    return jsonResponse({ ok: false, error: message });
  }
});
