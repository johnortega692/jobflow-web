export type SendVendorEmailPayload = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};

export type SendVendorEmailResult = { id: string };

function parseBody(raw: unknown): SendVendorEmailPayload {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    return raw as SendVendorEmailPayload;
  }
  if (typeof raw === "string" && raw.trim()) {
    return JSON.parse(raw) as SendVendorEmailPayload;
  }
  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString("utf8")) as SendVendorEmailPayload;
  }
  return { to: [], subject: "", html: "" };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function runSendVendorEmail(raw: unknown): Promise<SendVendorEmailResult> {
  const body = parseBody(raw);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Email sending is not configured. Add RESEND_API_KEY and EMAIL_FROM in Vercel environment variables (see DEPLOY.md).",
    );
  }

  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error(
      "EMAIL_FROM is not set. Example: John Ortega <noreply@yourdomain.com> (domain must be verified in Resend).",
    );
  }

  const to = (body.to ?? []).map((e) => e.trim()).filter(isValidEmail);
  if (!to.length) throw new Error("At least one valid To address is required.");

  const cc = (body.cc ?? []).map((e) => e.trim()).filter(isValidEmail);
  const subject = (body.subject ?? "").trim();
  if (!subject) throw new Error("Subject is required.");

  const html = (body.html ?? "").trim();
  if (!html) throw new Error("HTML body is required.");

  const payload: Record<string, unknown> = {
    from,
    to,
    subject,
    html,
  };
  if (cc.length) payload.cc = cc;
  if (body.text?.trim()) payload.text = body.text.trim();
  if (body.reply_to?.trim() && isValidEmail(body.reply_to.trim())) {
    payload.reply_to = body.reply_to.trim();
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const err = (await response.json()) as { message?: string; error?: string };
      detail = err.message ?? err.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Email send failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? "sent" };
}

export async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required to send email.");

  const url = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });
  if (!response.ok) throw new Error("Invalid or expired session. Sign in again.");
}
