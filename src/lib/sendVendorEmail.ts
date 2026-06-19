import { supabase } from "./supabase";

export type SendVendorEmailRequest = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};

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
