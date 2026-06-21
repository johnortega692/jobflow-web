import type { SendVendorEmailRequest } from "./sendVendorEmail";

export type GasEmailPost = (
  baseUrl: string,
  payload: SendVendorEmailRequest,
  action?: "sendVendorEmail" | "sendJobFlowEmail",
) => Promise<string>;

/** POST directly to the Dashboard web app (server / Node — no browser proxy). */
export async function sendVendorEmailGasDirect(
  baseUrl: string,
  payload: SendVendorEmailRequest,
  action: "sendVendorEmail" | "sendJobFlowEmail" = "sendVendorEmail",
): Promise<string> {
  const url = baseUrl.trim().replace(/\?.*$/, "");
  if (!url) throw new Error("Dashboard Web App URL not configured.");

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      to: payload.to,
      cc: payload.cc ?? [],
      subject: payload.subject,
      html: payload.html,
      text: payload.text ?? "",
      reply_to: payload.reply_to ?? "",
      from_name: payload.from_name ?? "",
    }),
  });

  const text = await upstream.text();
  let json: { status?: string; message?: string; id?: string } = {};
  try {
    json = text ? (JSON.parse(text) as typeof json) : {};
  } catch {
    json = { message: text };
  }

  if (!upstream.ok) throw new Error(`Email send failed (${upstream.status}).`);
  if (json.status !== "success") {
    const msg = json.message ?? "Email send was not successful.";
    if (/script\.send_mail|gmail\.send|permissions are not sufficient|web app deployment/i.test(msg)) {
      throw new Error(
        `${msg} Redeploy the Dashboard web app (Execute as: Me) and confirm the URL in Settings.`,
      );
    }
    throw new Error(msg);
  }
  return json.id ?? "sent";
}
