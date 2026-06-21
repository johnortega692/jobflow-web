import { supabase } from "./supabase";

import { sendVendorEmailViaGas } from "./sendVendorEmailGas";

export type SendVendorEmailRequest = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  /** Display name for From (Gmail send via Apps Script). */
  from_name?: string;
};

export type SendVendorEmailResult = {
  id: string;
  channel: "gas" | "resend";
};

/** Prefer Gmail via Dashboard web app when gasUrl is set; otherwise Resend API. */
export async function sendVendorEmail(
  payload: SendVendorEmailRequest,
  options?: { gasUrl?: string; gasAction?: "sendVendorEmail" | "sendJobFlowEmail" },
): Promise<SendVendorEmailResult> {
  const gasUrl = options?.gasUrl?.trim();
  if (gasUrl) {
    const id = await sendVendorEmailViaGas(gasUrl, payload, options?.gasAction);
    return { id, channel: "gas" };
  }
  const id = await sendVendorEmailFromApp(payload);
  return { id, channel: "resend" };
}

export async function sendVendorEmailFromApp(payload: SendVendorEmailRequest): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in required to send email.");

  const res = await fetch("/api/send-vendor-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Send failed (${res.status})`);
  return data.id ?? "sent";
}
