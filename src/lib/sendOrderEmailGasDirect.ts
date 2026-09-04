import type { SendVendorEmailRequest } from "./sendVendorEmail.js";

/** Field Tools / Field Request Order Apps Script payload. */
type SendOrderEmailParams = {
  to: string;
  cc?: string;
  subject: string;
  htmlBody: string;
  senderName: string;
  attachmentName?: string;
  attachmentBase64?: string;
};

type FieldOrderEmailAction = "sendOrderEmail" | "sendJobFlowEmail";

/** Tiny valid PDF — fallback if sendJobFlowEmail is not deployed yet. */
const DIGEST_PDF_NAME = "JobFlow-notification.pdf";
const DIGEST_PDF_BASE64 =
  "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdPj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTUKJSVFT0YK";

function vendorPayloadToJobFlowEmail(payload: SendVendorEmailRequest): SendOrderEmailParams {
  return {
    to: payload.to.filter(Boolean).join(", "),
    cc: (payload.cc ?? []).filter(Boolean).join(", "),
    subject: payload.subject,
    htmlBody: payload.html,
    senderName: payload.from_name?.trim() || "JobFlow",
  };
}

function vendorPayloadToOrderEmail(payload: SendVendorEmailRequest): SendOrderEmailParams {
  return {
    ...vendorPayloadToJobFlowEmail(payload),
    attachmentName: DIGEST_PDF_NAME,
    attachmentBase64: DIGEST_PDF_BASE64,
  };
}

function orderEmailBody(params: SendOrderEmailParams) {
  return {
    to: params.to,
    cc: params.cc ?? "",
    subject: params.subject,
    htmlBody: params.htmlBody,
    attachmentName: params.attachmentName ?? "",
    attachmentBase64: params.attachmentBase64 ?? "",
    senderName: params.senderName,
  };
}

function parseOrderEmailResponse(ok: boolean, status: number, text: string): string {
  let data: { success?: boolean; error?: string; message?: string; id?: string } = {};
  try {
    data = text ? (JSON.parse(text) as typeof data) : {};
  } catch {
    data = {};
  }

  if (!ok || data.success === false) {
    const msg =
      data.error ??
      data.message ??
      (text.trim().startsWith("<") ? "Email service was busy" : text.slice(0, 200));
    throw new Error(msg || `Email send failed (${status}).`);
  }
  if (data.success === true) return data.message ?? data.id ?? "sent-order-email";
  if (ok && status >= 200 && status < 300) {
    return data.message ?? data.id ?? "sent-order-email";
  }
  throw new Error(data.error ?? data.message ?? `Email send failed (${status}).`);
}

async function postFieldOrderEmail(
  baseUrl: string,
  params: SendOrderEmailParams,
  action: FieldOrderEmailAction,
): Promise<string> {
  const base = baseUrl.trim().replace(/\?.*$/, "");
  if (!base) throw new Error("Field Request Order URL not configured.");

  const upstream = await fetch(`${base}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderEmailBody(params)),
  });
  const text = await upstream.text();
  return parseOrderEmailResponse(upstream.ok, upstream.status, text);
}

/** Server / Node only — no browser or Vite imports. */
export async function sendVendorEmailAsOrderEmailDirect(
  baseUrl: string,
  payload: SendVendorEmailRequest,
): Promise<string> {
  try {
    return await postFieldOrderEmail(baseUrl, vendorPayloadToJobFlowEmail(payload), "sendJobFlowEmail");
  } catch {
    return postFieldOrderEmail(baseUrl, vendorPayloadToOrderEmail(payload), "sendOrderEmail");
  }
}
