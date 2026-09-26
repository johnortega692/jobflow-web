import { sendVendorEmailAsOrderEmailViaGas } from "./sendOrderEmailGas.js";
import { sendVendorEmailFromApp, type SendVendorEmailRequest } from "./sendVendorEmail.js";
import type { GasEmailPost } from "./sendVendorEmailGasDirect.js";

export type ScheduleEmailUrls = {
  fieldOrderUrl: string;
};

export function resolveScheduleEmailUrls(googleUrls: {
  field_request_order?: string;
}): ScheduleEmailUrls {
  return {
    fieldOrderUrl: (googleUrls.field_request_order ?? "").trim(),
  };
}

export function hasScheduleEmailChannel(urls: ScheduleEmailUrls, resendOk = false): boolean {
  return Boolean(urls.fieldOrderUrl || resendOk);
}

/**
 * Browser "Send now": Resend (`EMAIL_FROM` domain) first, then Field Request Gmail.
 */
export function createBrowserScheduleEmailPoster(urls: ScheduleEmailUrls): GasEmailPost {
  const fieldUrl = urls.fieldOrderUrl.trim();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    try {
      return await sendVendorEmailFromApp(payload);
    } catch (resendErr) {
      const msg = resendErr instanceof Error ? resendErr.message : "";
      const resendMissing = /RESEND_API_KEY|EMAIL_FROM|not configured/i.test(msg);
      if (!resendMissing || !fieldUrl) throw resendErr;
      return await sendVendorEmailAsOrderEmailViaGas(fieldUrl, payload);
    }
  };
}
