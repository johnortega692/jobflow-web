import { googleSheetsPost } from "./googleSheetsApi";
import type { SendVendorEmailRequest } from "./sendVendorEmail";

export async function sendVendorEmailViaGas(
  baseUrl: string | undefined,
  payload: SendVendorEmailRequest,
  action: "sendVendorEmail" | "sendJobFlowEmail" = "sendVendorEmail",
): Promise<string> {
  const url = baseUrl?.trim();
  if (!url) throw new Error("Dashboard Web App URL not configured in Settings.");

  const { status, json } = await googleSheetsPost(url, {
    action,
    to: payload.to,
    cc: payload.cc ?? [],
    subject: payload.subject,
    html: payload.html,
    text: payload.text ?? "",
    reply_to: payload.reply_to ?? "",
    from_name: payload.from_name ?? "",
  });

  if (status !== 200) throw new Error(`Email send failed (${status}).`);
  const data = json as { status?: string; message?: string; id?: string };
  if (data.status !== "success") {
    const msg = data.message ?? "Email send was not successful.";
    if (/script\.send_mail|gmail\.send|permissions are not sufficient|web app deployment/i.test(msg)) {
      throw new Error(
        `${msg} Redeploy the Dashboard web app (Deploy → Manage deployments → New version, Execute as: Me) and confirm the URL in Settings.`,
      );
    }
    throw new Error(msg);
  }
  return data.id ?? "sent";
}
