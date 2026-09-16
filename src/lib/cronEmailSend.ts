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
 * Cron email channel: Resend first (custom From domain), then Field Request Gmail.
 */
export function createCronEmailPoster(options: CronEmailPosterOptions | string): GasEmailPost {
  const fieldUrl =
    typeof options === "string" ? options.trim() : (options.fieldOrderUrl ?? "").trim();
  const resendOk = isResendConfigured();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (resendOk) {
      try {
        await runSendVendorEmail(payload);
        return "sent-resend";
      } catch (resendErr) {
        if (!fieldUrl) throw resendErr;
        return await sendVendorEmailAsOrderEmailDirect(fieldUrl, payload);
      }
    }

    if (fieldUrl) {
      return await sendVendorEmailAsOrderEmailDirect(fieldUrl, payload);
    }

    throw new Error(
      "Resend is not configured (RESEND_API_KEY + EMAIL_FROM), and Field Request Order URL is missing.",
    );
  };
}
