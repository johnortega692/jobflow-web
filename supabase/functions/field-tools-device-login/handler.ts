import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";
import { adminEmails, alertLink, deviceMail, sendDeviceNotice, stamp } from "./mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LoginRow = {
  ok?: boolean;
  error?: string;
  needs_code?: boolean;
  needs_admin?: boolean;
  user_id?: string;
  approval_requested?: boolean;
  session_token?: string;
  device_token?: string;
  idle_timeout_minutes?: number;
  profile?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textField(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, max);
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
  return real?.trim().slice(0, 64) || null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function challengeRow(data: unknown): { challenge_id?: string; code?: string; email?: string } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as { challenge_id?: string; code?: string; email?: string };
}

function codeEmail(code: string): { subject: string; text: string; html: string } {
  const subject = "Your Field Tools sign-in code";
  const text = `Your Field Tools sign-in code is ${code}. It expires in a few minutes. If you did not try to sign in, ignore this email.`;
  const html = `<p>Your Field Tools sign-in code is <strong>${code}</strong>.</p><p>It expires in a few minutes. If you did not try to sign in, ignore this email.</p>`;
  return { subject, text, html };
}

function publicError(message: string): string {
  if (message === "Wait a minute before requesting another code") return message;
  if (message === "Too many codes. Try again later") return message;
  if (message === "Ask your admin to approve this device") return message;
  return "Could not send the sign-in code. Try again.";
}

export async function handleDeviceAuth(req: Request, action: "login" | "verify"): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: "Sign in failed. Try again." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Sign in failed. Try again." }, 400);
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const supabase = createClient(supabaseUrl, serviceKey);

  if (action === "verify") {
    const challengeId = textField(body.challenge_id, 36);
    const code = textField(body.code, 6);
    const deviceToken = textField(body.device_token, 128);
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
      return jsonResponse({ ok: false, error: "That code is wrong or no longer valid." });
    }
    const { data, error } = await supabase.rpc("field_tools_verify_device_code", {
      p_challenge_id: challengeId,
      p_code: code,
      p_trust: body.trust === true,
      p_device_token: deviceToken || null,
      p_ip: ip,
      p_user_agent: userAgent,
    });
    if (error) return jsonResponse({ ok: false, error: "That code is wrong or no longer valid." });
    const verified = (data ?? null) as LoginRow | null;
    if (verified?.ok) {
      try {
        const { data: mode } = await supabase.rpc("field_tools_device_check_mode");
        const profileId = typeof verified.profile?.id === "string" ? verified.profile.id : "";
        if (mode === "enforce" && profileId) {
          const { data: opened } = await supabase.rpc("field_tools_open_device_alert", {
            p_user_id: profileId,
            p_device_token: typeof verified.device_token === "string" ? verified.device_token : deviceToken || null,
            p_user_agent: userAgent,
          });
          const notice = opened as { name?: string; email?: string; label?: string; action_token?: string; event_key?: string; admin_emails?: unknown } | null;
          if (notice?.action_token && notice.event_key) {
            const mail = deviceMail({
              subject: "New device signed in",
              intro: `${notice.name ?? "A crew member"} signed in on a new device.`,
              name: notice.name ?? "",
              label: notice.label,
              when: stamp(),
              lockUrl: alertLink(notice.action_token),
            });
            const recipients = [...adminEmails(notice)];
            if (notice.email) recipients.unshift(notice.email);
            await sendDeviceNotice(supabase, { recipients, eventKey: notice.event_key, subject: mail.subject, text: mail.text, html: mail.html });
          }
        }
      } catch {
        // A mail failure must not undo a successful sign-in.
      }
    } else if (/^[0-9a-f-]{36}$/i.test(challengeId)) {
      try {
        const { data: noticeData } = await supabase.rpc("field_tools_code_lockout_notice", { p_challenge_id: challengeId });
        const notice = noticeData as { exhausted?: boolean; name?: string; email?: string; event_key?: string; admin_emails?: unknown } | null;
        if (notice?.exhausted && notice.event_key) {
          const mail = deviceMail({
            subject: "Sign-in code locked",
            intro: `Someone entered the wrong sign-in code too many times for ${notice.name ?? "a crew member"}.`,
            name: notice.name ?? "",
            when: stamp(),
          });
          const recipients = [...adminEmails(notice)];
          if (notice.email) recipients.unshift(notice.email);
          await sendDeviceNotice(supabase, { recipients, eventKey: notice.event_key, subject: mail.subject, text: mail.text, html: mail.html });
        }
      } catch {
        // Keep the lockout response even if the notice email fails.
      }
    }
    return jsonResponse(verified ?? { ok: false, error: "That code is wrong or no longer valid." });
  }

  const pin = textField(body.pin, 12);
  const deviceToken = textField(body.device_token, 128);
  if (pin.length < 4) return jsonResponse({ ok: false, error: "Enter at least 4 digits" });

  const { data, error } = await supabase.rpc("field_tools_login_pin_v2", {
    p_pin: pin,
    p_device_token: deviceToken || null,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) return jsonResponse({ ok: false, error: "Sign in failed. Try again." }, 500);

  const result = (data ?? null) as LoginRow | null;
  if (result?.needs_admin) {
    if (result.approval_requested && result.user_id) {
      try {
        const [{ data: facts }, { data: devices }] = await Promise.all([
          supabase.rpc("field_tools_device_mail_facts", { p_user_id: result.user_id }),
          supabase.rpc("device_admin_devices", { p_user_id: result.user_id }),
        ]);
        const info = facts as { name?: string; admin_emails?: unknown } | null;
        const pending = (devices as { requests?: { label?: string }[] } | null)?.requests ?? [];
        const mail = deviceMail({
          subject: "Device approval requested",
          intro: `${info?.name ?? "A crew member"} needs a device approved.`,
          name: info?.name ?? "",
          label: pending[0]?.label || "Unknown device",
          when: stamp(),
        });
        await sendDeviceNotice(supabase, {
          recipients: adminEmails(info ?? {}),
          eventKey: `approval-requested:${result.user_id}`,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
      } catch {
        // The pending request is already saved. Return the screen even if mail fails.
      }
    }
    return jsonResponse({
      ok: false,
      needs_admin: true,
      error: result.error || "Ask your admin to approve this device",
      device_token: result.device_token,
    });
  }
  if (!result?.needs_code) return jsonResponse(result ?? { ok: false, error: "Sign in failed. Try again." });

  const userId = textField(result.user_id, 36);
  const { data: created, error: createError } = await supabase.rpc("field_tools_create_device_challenge", {
    p_user_id: userId,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (createError) {
    return jsonResponse({ ok: false, error: publicError(createError.message) });
  }

  const row = challengeRow(created);
  const code = row?.code?.trim() ?? "";
  const email = row?.email?.trim() ?? "";
  const challengeId = row?.challenge_id?.trim() ?? "";
  if (!/^\d{6}$/.test(code) || !email || !challengeId) {
    return jsonResponse({ ok: false, error: "Could not send the sign-in code. Try again." });
  }

  const mail = codeEmail(code);
  const sent = await sendJobFlowNotification({
    to: email,
    subject: mail.subject,
    htmlBody: mail.html,
    text: mail.text,
    jobFlowOnly: true,
  });
  if (!sent.ok) {
    await supabase.rpc("field_tools_void_device_challenge", { p_challenge_id: challengeId });
    return jsonResponse({ ok: false, error: "Could not send the sign-in code. Try again." });
  }

  return jsonResponse({
    needs_code: true,
    challenge_id: challengeId,
    masked_email: maskEmail(email),
  });
}
