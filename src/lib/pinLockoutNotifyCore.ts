import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabaseAdmin";

export type PinLockoutPendingRow = {
  id: string;
  app: string;
  lock_kind: string;
  message: string;
  created_at: string;
};

export type PinLockoutNotifyResult = {
  sent: boolean;
  recipientCount: number;
  alertCount: number;
  skipped?: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendResendEmail(params: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM must be set for PIN lockout alerts.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const err = (await response.json()) as { message?: string; error?: string };
      detail = err.message ?? err.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`PIN lockout email failed (${response.status}): ${detail}`);
  }
}

export async function runPinLockoutNotify(): Promise<PinLockoutNotifyResult> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL for PIN lockout notify.");
  }

  const admin = getSupabaseAdmin();

  const { data: pending, error: pendingError } = await admin.rpc("pin_lockout_list_pending" as never);
  if (pendingError) throw new Error(pendingError.message);

  const rows = (pending ?? []) as PinLockoutPendingRow[];
  if (!rows.length) {
    return { sent: false, recipientCount: 0, alertCount: 0, skipped: "no pending alerts" };
  }

  const { data: emailRows, error: emailError } = await admin.rpc("pin_security_admin_emails" as never);
  if (emailError) throw new Error(emailError.message);

  const recipients = ((emailRows ?? []) as string[])
    .map((e) => e.trim().toLowerCase())
    .filter(isValidEmail);

  if (!recipients.length) {
    return {
      sent: false,
      recipientCount: 0,
      alertCount: rows.length,
      skipped: "no admin alert emails configured",
    };
  }

  const lines = rows.map(
    (row) =>
      `• ${row.created_at.replace("T", " ").slice(0, 19)} UTC — ${row.message}`,
  );

  const subject = `[JobFlow Security] PIN login lockout (${rows.length} alert${rows.length === 1 ? "" : "s"})`;
  const text = [
    "One or more PIN login lockouts were triggered:",
    "",
    ...lines,
    "",
    "This is an automated security alert from JobFlow / Field Tools / Manpower Cal.",
  ].join("\n");

  const html = [
    "<p>One or more PIN login lockouts were triggered:</p>",
    "<ul>",
    ...rows.map((row) => `<li><strong>${row.app}</strong> — ${row.message}</li>`),
    "</ul>",
    "<p style=\"color:#666;font-size:13px\">Automated security alert from JobFlow.</p>",
  ].join("");

  await sendResendEmail({ to: recipients, subject, html, text });

  const ids = rows.map((row) => row.id);
  const { error: markError } = await admin.rpc("pin_lockout_mark_notified" as never, {
    p_ids: ids,
  } as never);
  if (markError) throw new Error(markError.message);

  return { sent: true, recipientCount: recipients.length, alertCount: rows.length };
}
