import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildSignRequestEmail, companyNameFromSettings, extraWorkSignOrigin } from "../extraWorkTagEmail.ts";
import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";

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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as { caller_id?: string; session_token?: string; token?: string; origin?: string };
    const callerId = body.caller_id?.trim() ?? "";
    const sessionToken = body.session_token?.trim() ?? "";
    const token = body.token?.trim() ?? "";
    if (!callerId || !sessionToken || !token) {
      return jsonResponse({ ok: false, error: "Sign in again, then send the link." });
    }

    const { data, error } = await supabase.rpc("field_tools_extra_work_link_for_mail", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
      p_token: token,
    });
    if (error) return jsonResponse({ ok: false, error: error.message });
    const link = data as { ok?: boolean; error?: string; email?: string; job_number?: string; job_name?: string; tag_number?: string };
    if (!link?.ok || !link.email) return jsonResponse({ ok: false, error: link?.error ?? "That signature link is no longer active." });

    const tokenHash = await sha256Hex(token);
    const { data: linkRow } = await supabase
      .from("field_tools_extra_work_links")
      .select("tag_id, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    const { data: tagRow } = linkRow?.tag_id
      ? await supabase
          .from("field_tools_extra_work_tags")
          .select("tag_date, description, submitted_by_name")
          .eq("id", linkRow.tag_id)
          .maybeSingle()
      : { data: null };
    const { data: org } = await supabase.from("org_settings").select("settings").eq("id", 1).maybeSingle();
    const companyName = companyNameFromSettings(
      (org?.settings ?? null) as Record<string, unknown> | null,
      Deno.env.get("COMPANY_NAME")?.trim() || Deno.env.get("VITE_COMPANY_NAME")?.trim() || "",
    );
    const origin = extraWorkSignOrigin(body.origin?.trim() ?? "", {
      publicUrl: Deno.env.get("FIELD_TOOLS_PUBLIC_URL")?.trim() || "",
      supabaseUrl: supabaseUrl,
    });
    const mail = buildSignRequestEmail({
      companyName,
      tagNumber: String(link.tag_number ?? ""),
      jobNumber: String(link.job_number ?? ""),
      jobName: String(link.job_name ?? ""),
      tagDate: String(tagRow?.tag_date ?? ""),
      work: String(tagRow?.description ?? ""),
      preparerName: String(tagRow?.submitted_by_name ?? ""),
      signUrl: `${origin}/sign-tag/${token}`,
      expiresAt: String(linkRow?.expires_at ?? (link as { expires_at?: string }).expires_at ?? ""),
    });
    const addresses = String(link.email)
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const sent = await sendJobFlowNotification({
      to: addresses[0] ?? link.email,
      cc: addresses.slice(1).join(", "),
      subject: mail.subject,
      htmlBody: mail.html,
      text: mail.text,
      fromName: companyName,
      jobFlowOnly: true,
    });
    if (!sent.ok) return jsonResponse({ ok: false, error: sent.message });
    return jsonResponse({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not email the link.";
    return jsonResponse({ ok: false, error: message });
  }
});
