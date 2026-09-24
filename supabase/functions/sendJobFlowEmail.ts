const DIGEST_PDF_NAME = "JobFlow-notification.pdf";
const DIGEST_PDF_BASE64 =
  "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdPj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTUKJSVFT0YK";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function splitEmails(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(isValidEmail);
}

async function sendViaResend(params: {
  to: string;
  cc?: string;
  subject: string;
  htmlBody: string;
}): Promise<{ ok: boolean; message: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("EMAIL_FROM")?.trim();
  if (!apiKey || !from || apiKey === "[SENSITIVE]" || !apiKey.startsWith("re_")) {
    return { ok: false, message: "Resend not configured" };
  }

  const to = splitEmails(params.to);
  if (!to.length) return { ok: false, message: "No valid To address" };
  const cc = splitEmails(params.cc ?? "");

  const payload: Record<string, unknown> = {
    from,
    to,
    subject: params.subject,
    html: params.htmlBody,
  };
  if (cc.length) payload.cc = cc;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = JSON.parse(text) as { message?: string; error?: string };
      detail = err.message ?? err.error ?? detail;
    } catch {
      /* ignore */
    }
    return { ok: false, message: `Resend ${res.status}: ${detail}` };
  }
  return { ok: true, message: "sent-resend" };
}

async function postGas(
  base: string,
  action: "sendJobFlowEmail" | "sendOrderEmail",
  params: {
    to: string;
    cc?: string;
    subject: string;
    htmlBody: string;
    senderName: string;
    attachmentName?: string;
    attachmentBase64?: string;
  },
): Promise<{ ok: boolean; message: string }> {
  const url = `${base}${base.includes("?") ? "&" : "?"}action=${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: params.to,
      cc: params.cc ?? "",
      subject: params.subject,
      htmlBody: params.htmlBody,
      senderName: params.senderName,
      attachmentName: params.attachmentName ?? "",
      attachmentBase64: params.attachmentBase64 ?? "",
    }),
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

/** JobFlow From via Resend, then Field Request Gmail. */
export async function sendJobFlowNotification(params: {
  to: string;
  cc?: string;
  subject: string;
  htmlBody: string;
  attachmentName?: string;
  attachmentBase64?: string;
}): Promise<{ ok: boolean; message: string }> {
  const resend = await sendViaResend(params);
  if (resend.ok) return resend;

  const base = Deno.env.get("GAS_SEND_EMAIL_URL")?.trim();
  if (!base) return { ok: false, message: resend.message };

  const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || "JobFlow";
  const gasParams = { ...params, senderName };
  const jobFlow = await postGas(base, "sendJobFlowEmail", gasParams);
  if (jobFlow.ok) return jobFlow;

  return await postGas(base, "sendOrderEmail", {
    ...gasParams,
    attachmentName: params.attachmentName || DIGEST_PDF_NAME,
    attachmentBase64: params.attachmentBase64 || DIGEST_PDF_BASE64,
  });
}
