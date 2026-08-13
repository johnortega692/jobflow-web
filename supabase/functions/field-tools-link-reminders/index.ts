import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

type DigestPerson = {
  profile_id: string;
  name: string;
  email: string;
  missing: string[];
};

async function buildTinyPdf(name: string, missing: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 740;
  page.drawText("Field Tools reminder", { x: 48, y, size: 18, font: bold });
  y -= 28;
  page.drawText(`Hi ${name},`, { x: 48, y, size: 12, font });
  y -= 20;
  page.drawText("These items were not opened in Field Tools:", { x: 48, y, size: 12, font });
  y -= 22;
  for (const item of missing) {
    page.drawText(`• ${item}`, { x: 60, y, size: 12, font });
    y -= 18;
  }
  return doc.save();
}

async function sendGasEmail(params: {
  to: string;
  subject: string;
  htmlBody: string;
  attachmentName: string;
  attachmentBase64: string;
  senderName: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = Deno.env.get("GAS_SEND_EMAIL_URL")?.trim();
  if (!base) return { ok: false, message: "GAS_SEND_EMAIL_URL not configured" };
  const url = `${base}${base.includes("?") ? "&" : "?"}action=sendOrderEmail`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, cc: "" }),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || "Ironwood Commercial Builders";
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

    const { data: digest, error: digestErr } = await supabase.rpc("field_tools_link_incomplete_digest");
    if (digestErr) return jsonResponse({ ok: false, error: digestErr.message }, 500);

    const people = (Array.isArray(digest) ? digest : []) as DigestPerson[];
    let sent = 0;
    let failed = 0;
    for (const person of people) {
      const missing = (person.missing ?? []).map((t) => String(t).trim()).filter(Boolean);
      const email = person.email.trim();
      if (!email || !missing.length) continue;
      const list = missing.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
      const html = `<p>Hi ${escapeHtml(person.name)},</p>
<p>This is a reminder that the following ${missing.length === 1 ? "item was" : "items were"} not completed in Field Tools as of Friday 3pm:</p>
<ul>${list}</ul>
<p>Please open ${missing.length === 1 ? "it" : "them"} from the Field Tools hub when you can.</p>`;
      const pdf = await buildTinyPdf(person.name, missing);
      const result = await sendGasEmail({
        to: email,
        subject: "Field Tools — reports not completed",
        htmlBody: html,
        attachmentName: "Field-Tools-reminder.pdf",
        attachmentBase64: bytesToBase64(pdf),
        senderName,
      });
      if (result.ok) sent++;
      else failed++;
    }

    return jsonResponse({ ok: true, recipients: people.length, sent, failed });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Reminder failed" }, 500);
  }
});
