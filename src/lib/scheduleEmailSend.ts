import { sendVendorEmailAsOrderEmailViaGas } from "./sendOrderEmailGas";
import type { GasEmailPost } from "./sendVendorEmailGasDirect";
import type { SendVendorEmailRequest } from "./sendVendorEmail";

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
 * Browser "Send now" poster: Field Request Order Gmail.
 * (No Resend from the browser — that requires the authenticated /api/send-vendor-email path.)
 */
export function createBrowserScheduleEmailPoster(urls: ScheduleEmailUrls): GasEmailPost {
  const fieldUrl = urls.fieldOrderUrl.trim();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (fieldUrl) {
      return await sendVendorEmailAsOrderEmailViaGas(fieldUrl, payload);
    }
    throw new Error(
      "Set Field Request Order URL in Settings → Mailing Settings (same URL Field Tools uses).",
    );
  };
}
