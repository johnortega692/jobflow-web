import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { adminEmails, deviceMail, sendDeviceNotice, stamp } from "../field-tools-device-login/mail.ts";

function page(inner: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Field Tools</title></head><body style="font-family:sans-serif;padding:32px">${inner}</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function invalidPage(): Response {
  return page("<p>This link is no longer valid.</p>");
}

function confirmPage(token: string): Response {
  return page(
    `<p>Lock your account?</p>` +
      `<p>This signs you out everywhere. Your admin will need to restore access.</p>` +
      `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}">` +
      `<button type="submit">Lock my account</button></form>` +
      `<p>If this was you, close this page.</p>`,
  );
}

function lockedPage(): Response {
  return page("<p>Your account is locked. Contact your admin to get back in.</p>");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type AlertRow = { used_at: string | null; expires_at: string };

async function tokenIsOpen(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<boolean> {
  const hash = await sha256Hex(token);
  const { data, error } = await supabase
    .from("device_alert_actions")
    .select("used_at, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as AlertRow;
  if (row.used_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

async function postedToken(req: Request, url: URL): Promise<string> {
  const fromQuery = url.searchParams.get("token")?.trim() ?? "";
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as { token?: unknown };
      if (typeof body.token === "string" && body.token.trim()) return body.token.trim();
    } else if (type.includes("form") || type.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const posted = form.get("token");
      if (typeof posted === "string" && posted.trim()) return posted.trim();
    } else {
      const text = (await req.text()).trim();
      if (text.startsWith("{")) {
        const body = JSON.parse(text) as { token?: unknown };
        if (typeof body.token === "string" && body.token.trim()) return body.token.trim();
      } else if (text.includes("=")) {
        const posted = new URLSearchParams(text).get("token")?.trim() ?? "";
        if (posted) return posted;
      }
    }
  } catch {
    // Fall back to the query string.
  }
  return fromQuery;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") return invalidPage();

  const token = method === "POST"
    ? await postedToken(req, url)
    : (url.searchParams.get("token")?.trim() ?? "");
  if (!token) return method === "HEAD" ? new Response(null, { status: 200 }) : invalidPage();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return invalidPage();
  const supabase = createClient(supabaseUrl, serviceKey);

  if (method === "GET" || method === "HEAD") {
    const open = await tokenIsOpen(supabase, token);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Content-Length": "0" } });
    }
    return open ? confirmPage(token) : invalidPage();
  }

  const { data, error } = await supabase.rpc("field_tools_consume_alert_action", { p_token: token });
  if (error || !data || (data as { ok?: boolean }).ok !== true) return invalidPage();

  const facts = data as { name?: string; event_key?: string; admin_emails?: unknown };
  const mail = deviceMail({
    subject: "Account locked",
    intro: `${facts.name ?? "A crew member"} locked their account from a new-device email.`,
    name: facts.name ?? "",
    when: stamp(),
  });
  await sendDeviceNotice(supabase, {
    recipients: adminEmails(facts),
    eventKey: facts.event_key ?? "account-locked",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  return lockedPage();
});
