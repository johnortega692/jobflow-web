import { sendVendorEmailAsOrderEmailViaGas } from "./sendOrderEmailGas";
import type { GasEmailPost } from "./sendVendorEmailGasDirect";
import { sendVendorEmailViaGas } from "./sendVendorEmailGas";
import type { SendVendorEmailRequest } from "./sendVendorEmail";

export type ScheduleEmailUrls = {
  fieldOrderUrl: string;
  dashboardUrl: string;
};

/** Resolve Field Tools + Dashboard URLs from paint settings (browser-safe). */
export function resolveScheduleEmailUrls(googleUrls: {
  field_request_order?: string;
  paint_tracker?: string;
}): ScheduleEmailUrls {
  return {
    fieldOrderUrl: (googleUrls.field_request_order ?? "").trim(),
    dashboardUrl: (googleUrls.paint_tracker ?? "").trim(),
  };
}

export function hasScheduleEmailChannel(urls: ScheduleEmailUrls, resendOk = false): boolean {
  return Boolean(urls.fieldOrderUrl || urls.dashboardUrl || resendOk);
}

/**
 * Browser "Send now" poster: Field Tools sendOrderEmail first, then Dashboard sendVendorEmail.
 * (No Resend from the browser — that requires the authenticated /api/send-vendor-email path via sendVendorEmail.)
 */
export function createBrowserScheduleEmailPoster(urls: ScheduleEmailUrls): GasEmailPost {
  const fieldUrl = urls.fieldOrderUrl.trim();
  const dashUrl = urls.dashboardUrl.trim();

  return async (_baseUrl, payload: SendVendorEmailRequest) => {
    if (fieldUrl) {
      try {
        return await sendVendorEmailAsOrderEmailViaGas(fieldUrl, payload);
      } catch (fieldErr) {
        if (!dashUrl) throw fieldErr;
        return await sendVendorEmailViaGas(dashUrl, payload);
      }
    }
    if (dashUrl) {
      return await sendVendorEmailViaGas(dashUrl, payload);
    }
    throw new Error(
      "Set Field Request Order URL in Settings → Google Sheets (same URL Field Tools uses).",
    );
  };
}
