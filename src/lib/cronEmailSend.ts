import { runSendVendorEmail } from "../../server/sendVendorEmailCore";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";
import type { SendVendorEmailRequest } from "./sendVendorEmail";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/**
 * Cron email channel: prefer Dashboard Gmail web app, fall back to Resend when
 * the URL is missing or the Apps Script send fails.
 */
export function createCronEmailPoster(gasUrl: string): GasEmailPost {
  const url = gasUrl.trim();
  const resendOk = isResendConfigured();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (url) {
      try {
        return await sendVendorEmailGasDirect(url, payload);
      } catch (err) {
        if (!resendOk) throw err;
        await runSendVendorEmail(payload);
        return "sent-resend-fallback";
      }
    }
    if (!resendOk) {
      throw new Error(
        "Missing Dashboard Web App URL, and Resend is not configured (RESEND_API_KEY + EMAIL_FROM).",
      );
    }
    await runSendVendorEmail(payload);
    return "sent-resend";
  };
}
