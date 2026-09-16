import { sendVendorEmailAsOrderEmailViaGas } from "./sendOrderEmailGas";
import { sendVendorEmailFromApp, type SendVendorEmailRequest } from "./sendVendorEmail";
import type { GasEmailPost } from "./sendVendorEmailGasDirect";

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
      if (!fieldUrl) throw resendErr;
      try {
        return await sendVendorEmailAsOrderEmailViaGas(fieldUrl, payload);
      } catch {
        throw resendErr;
      }
    }
  };
}
