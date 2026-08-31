import { runSendVendorEmail } from "../../server/sendVendorEmailCore";
import { sendVendorEmailAsOrderEmailDirect } from "./sendOrderEmailGasDirect";
import { sendVendorEmailGasDirect, type GasEmailPost } from "./sendVendorEmailGasDirect";
import type { SendVendorEmailRequest } from "./sendVendorEmail";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export type CronEmailPosterOptions = {
  /** Field Tools / Field Request Order URL (`sendOrderEmail`) — preferred. */
  fieldOrderUrl?: string;
  /** Dashboard Web App URL (`sendVendorEmail`) — fallback. */
  dashboardUrl?: string;
};

/**
 * Cron email channel: prefer Field Tools sendOrderEmail (working path),
 * then Dashboard sendVendorEmail, then Resend.
 */
export function createCronEmailPoster(options: CronEmailPosterOptions | string): GasEmailPost {
  // Backward compatible: createCronEmailPoster(dashboardUrl)
  const fieldUrl =
    typeof options === "string" ? "" : (options.fieldOrderUrl ?? "").trim();
  const dashUrl =
    typeof options === "string" ? options.trim() : (options.dashboardUrl ?? "").trim();
  const resendOk = isResendConfigured();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (fieldUrl) {
      try {
        return await sendVendorEmailAsOrderEmailDirect(fieldUrl, payload);
      } catch (fieldErr) {
        if (dashUrl) {
          try {
            return await sendVendorEmailGasDirect(dashUrl, payload);
          } catch {
            if (!resendOk) throw fieldErr;
            await runSendVendorEmail(payload);
            return "sent-resend-fallback";
          }
        }
        if (!resendOk) throw fieldErr;
        await runSendVendorEmail(payload);
        return "sent-resend-fallback";
      }
    }

    if (dashUrl) {
      try {
        return await sendVendorEmailGasDirect(dashUrl, payload);
      } catch (err) {
        if (!resendOk) throw err;
        await runSendVendorEmail(payload);
        return "sent-resend-fallback";
      }
    }

    if (!resendOk) {
      throw new Error(
        "Missing Field Request Order URL (and Dashboard Web App URL), and Resend is not configured (RESEND_API_KEY + EMAIL_FROM).",
      );
    }
    await runSendVendorEmail(payload);
    return "sent-resend";
  };
}
