import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { adminEmails, deviceMail, sendDeviceNotice, stamp } from "../field-tools-device-login/mail.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ ok: false, error: "Sign in again." }, 500);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Sign in again." }, 400);
  }

  const callerId = typeof body.caller_id === "string" ? body.caller_id.trim() : "";
  const sessionToken = typeof body.session_token === "string" ? body.session_token.trim() : "";
  if (!callerId || !sessionToken) return jsonResponse({ ok: false, error: "Sign in again." }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  const { error: authError } = await supabase.rpc("field_tools_require_admin", {
    p_caller_id: callerId,
    p_session_token: sessionToken,
  });
  if (authError) return jsonResponse({ ok: false, error: "Sign in again." }, 401);

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : null;
  const userId = typeof body.user_id === "string" ? body.user_id : null;

  const calls: Record<string, { fn: string; args: Record<string, unknown> }> = {
    overview: { fn: "device_admin_overview", args: {} },
    people: { fn: "device_admin_people", args: {} },
    devices: { fn: "device_admin_devices", args: { p_user_id: userId } },
    events: {
      fn: "device_admin_events",
      args: { p_limit: Number(body.limit ?? 50), p_filter: typeof body.filter === "string" ? body.filter : "all" },
    },
    set_mode: { fn: "device_admin_set_mode", args: { p_mode: body.mode, p_admin_id: callerId } },
    approve: { fn: "device_admin_approve", args: { p_request_id: id, p_admin_id: callerId } },
    deny: { fn: "device_admin_deny", args: { p_request_id: id, p_admin_id: callerId } },
    revoke: { fn: "device_admin_revoke", args: { p_device_id: id, p_admin_id: callerId } },
    set_shared: {
      fn: "device_admin_set_shared",
      args: { p_device_id: id, p_shared: body.shared === true, p_admin_id: callerId },
    },
    rename: {
      fn: "device_admin_rename",
      args: {
        p_device_id: id,
        p_nickname: typeof body.nickname === "string" ? body.nickname : "",
        p_admin_id: callerId,
      },
    },
    unlock: { fn: "device_admin_unlock", args: { p_user_id: userId, p_admin_id: callerId } },
    update_settings: {
      fn: "device_admin_update_settings",
      args: {
        p_trust_days: Number(body.trust_days),
        p_shared_idle_minutes: Number(body.shared_idle_minutes),
        p_admin_emails: Array.isArray(body.admin_emails) ? body.admin_emails : [],
      },
    },
  };

  const call = calls[action];
  if (!call) return jsonResponse({ ok: false, error: "Unknown action" }, 400);

  const { data, error } = await supabase.rpc(call.fn, call.args);
  if (error) return jsonResponse({ ok: false, error: "Could not update device security." }, 500);
  const result = (data ?? { ok: false }) as {
    ok?: boolean;
    notify?: { name?: string; email?: string; label?: string; event_key?: string; admin_emails?: unknown };
  };

  if (action === "approve" && result.ok && result.notify?.event_key) {
    const notice = result.notify;
    const mail = deviceMail({
      subject: "Device approved",
      intro: `${notice.name ?? "A crew member"} can sign in on this device.`,
      name: notice.name ?? "",
      label: notice.label,
      when: stamp(),
    });
    const recipients = [...adminEmails(notice)];
    if (notice.email) recipients.unshift(notice.email);
    await sendDeviceNotice(supabase, {
      recipients,
      eventKey: notice.event_key,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  if (result && typeof result === "object" && "notify" in result) {
    const { notify: _notify, ...rest } = result;
    return jsonResponse(rest);
  }
  return jsonResponse(result);
});
