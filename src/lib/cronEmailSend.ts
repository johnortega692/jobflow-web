import { runSendVendorEmail } from "../../server/sendVendorEmailCore.js";
import { sendVendorEmailAsOrderEmailDirect } from "./sendOrderEmailGasDirect.js";
import type { GasEmailPost } from "./sendVendorEmailGasDirect.js";
import type { SendVendorEmailRequest } from "./sendVendorEmail.js";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export type CronEmailPosterOptions = {
  /** Field Request Order URL (`sendJobFlowEmail`, then `sendOrderEmail`). */
  fieldOrderUrl?: string;
};

/**
 * Cron email channel: Field Request Order Gmail, then Resend.
 */
export function createCronEmailPoster(options: CronEmailPosterOptions | string): GasEmailPost {
  const fieldUrl =
    typeof options === "string" ? options.trim() : (options.fieldOrderUrl ?? "").trim();
  const resendOk = isResendConfigured();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (fieldUrl) {
      try {
        return await sendVendorEmailAsOrderEmailDirect(fieldUrl, payload);
      } catch (fieldErr) {
        if (!resendOk) throw fieldErr;
        await runSendVendorEmail(payload);
        return "sent-resend-fallback";
      }
    }

    if (!resendOk) {
      throw new Error(
        "Missing Field Request Order URL, and Resend is not configured (RESEND_API_KEY + EMAIL_FROM).",
      );
    }
    await runSendVendorEmail(payload);
    return "sent-resend";
  };
}
