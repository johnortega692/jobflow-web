import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PDF_CHARS = 28_000_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part));
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.35;white-space:pre-wrap;margin:0">${escaped}</pre>`;
}

function gasErrorMessage(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) return `Email service HTTP ${status}`;
  if (trimmed.startsWith("<") || /unable to open the file/i.test(trimmed) || /page not found/i.test(trimmed)) {
    return "Email service was busy. The record is saved — use Email again if it did not arrive.";
  }
  return trimmed.slice(0, 240);
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

const PDF_BUCKET = "safety-record-pdfs";

function pdfBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function recordTable(kind: string): "field_tools_field_reports" | "field_tools_safety_inspections" {
  return kind === "field_report" ? "field_tools_field_reports" : "field_tools_safety_inspections";
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
      p_caller_id?: string;
      p_session_token?: string;
      kind?: string;
      record_id?: string;
      subject?: string;
      body?: string;
      filename?: string;
      pdf_base64?: string;
    };
    const callerId = (body.caller_id ?? body.p_caller_id)?.trim();
    const sessionToken = (body.session_token ?? body.p_session_token)?.trim();
    const kind = body.kind?.trim();
    const recordId = body.record_id?.trim() ?? "";
    const action = body.action?.trim() || "email";
    const subject = body.subject?.trim() ?? "";
    const textBody = body.body?.trim() ?? "";
    const filename = (body.filename?.trim() || "safety-record.pdf").replace(/[\\/:*?"<>|]/g, "").slice(0, 180);
    const pdfBase64 = normalizePdfBase64(body.pdf_base64 ?? "");

    if (!callerId || !sessionToken) {
      console.error("safety-record-email reject missing_session");
      return jsonResponse({ ok: false, error: "Sign in again, then use Email again." });
    }
    if (kind !== "field_report" && kind !== "inspection") {
      console.error("safety-record-email reject bad_kind");
      return jsonResponse({ ok: false, error: "Choose Field Report or Safety Inspection." });
    }

    const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    if (sessionErr) {
      const msg = /SESSION|INVALID/i.test(sessionErr.message) ? "Invalid or expired session. Log in again." : sessionErr.message;
      console.error("safety-record-email reject session");
      return jsonResponse({ ok: false, error: msg });
    }
    const profileResult = sessionProfile as { ok?: boolean; error?: string; profile?: { email?: string; role?: string } };
    if (!profileResult?.ok) {
      console.error("safety-record-email reject session_profile");
      return jsonResponse({ ok: false, error: profileResult?.error ?? "Invalid session" });
    }

    const table = recordTable(kind);
    const role = profileResult.profile?.role ?? "";
    async function canReadRecord(): Promise<{ path: string; filename: string } | null> {
      if (!recordId) return null;
      const { data, error } = await supabase
        .from(table)
        .select("submitted_by_profile_id, pdf_storage_path, pdf_filename")
        .eq("id", recordId)
        .maybeSingle();
      if (error || !data) return null;
      const owner = data.submitted_by_profile_id === callerId;
      const office = kind === "field_report" && (role === "admin" || role === "super");
      if (!owner && !office) return null;
      return {
        path: String(data.pdf_storage_path ?? ""),
        filename: String(data.pdf_filename ?? ""),
      };
    }

    if (action === "link") {
      const stored = await canReadRecord();
      if (!stored?.path) return jsonResponse({ ok: false, error: "That PDF is not saved yet." });
      const signed = await supabase.storage.from(PDF_BUCKET).createSignedUrl(stored.path, 60 * 10, {
        download: stored.filename || true,
      });
      if (signed.error || !signed.data?.signedUrl) {
        return jsonResponse({ ok: false, error: signed.error?.message || "Could not open the PDF." });
      }
      return jsonResponse({ ok: true, url: signed.data.signedUrl, filename: stored.filename });
    }

    if (!subject || !isPdfBase64(pdfBase64)) {
      console.error("safety-record-email reject bad_pdf", pdfBase64.slice(0, 24), pdfBase64.length);
      return jsonResponse({ ok: false, error: "The PDF could not be emailed. Download it and try again." });
    }

    let pdfPath = "";
    const readable = await canReadRecord();
    if (readable) {
      const path = `${kind}/${recordId}.pdf`;
      const uploaded = await supabase.storage.from(PDF_BUCKET).upload(path, new Blob([pdfBytes(pdfBase64)]), {
        contentType: "application/pdf",
        upsert: true,
      });
      if (uploaded.error) {
        console.error("safety-record-email store", uploaded.error.message.slice(0, 180));
      } else {
        const savedName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
        const updated = await supabase.from(table).update({ pdf_storage_path: path, pdf_filename: savedName }).eq("id", recordId);
        if (updated.error) console.error("safety-record-email path", updated.error.message.slice(0, 180));
        else pdfPath = path;
      }
    }

    const { data: settings, error: settingsErr } = await supabase
      .from("field_tools_safety_record_mail")
      .select("field_report_to_email, inspection_to_email")
      .eq("id", 1)
      .maybeSingle();
    if (settingsErr) return jsonResponse({ ok: false, error: settingsErr.message, pdf_path: pdfPath });

    const rawTo = kind === "field_report" ? settings?.field_report_to_email : settings?.inspection_to_email;
    const addresses = parseEmailList(rawTo ?? "");
    if (!addresses.length) {
      return jsonResponse({ ok: true, emailed: false, reason: "no_address", pdf_path: pdfPath });
    }

    const cc = addresses.slice(1);
    const submitter = parseEmailList(profileResult.profile?.email ?? "")[0];
    if (submitter && !addresses.includes(submitter)) cc.push(submitter);

    const sent = await sendJobFlowNotification({
      to: addresses[0]!,
      cc: cc.join(","),
      subject: subject.slice(0, 200),
      htmlBody: textToHtml(textBody || subject),
      text: textBody || subject,
      attachmentName: filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`,
      attachmentBase64: pdfBase64,
      jobFlowOnly: true,
    });
    if (!sent.ok) {
      console.error("safety-record-email reject send");
      return jsonResponse({ ok: false, error: gasErrorMessage(sent.message, 502), pdf_path: pdfPath });
    }
    return jsonResponse({ ok: true, emailed: true, pdf_path: pdfPath });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not email the PDF.";
    console.error("safety-record-email reject throw", message.slice(0, 180));
    return jsonResponse({ ok: false, error: message });
  }
});
