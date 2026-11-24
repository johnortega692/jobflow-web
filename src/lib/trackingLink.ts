export type TrackingCarrier = "UPS" | "FedEx" | "USPS" | "Google";

export type TrackingLink = {
  number: string;
  carrier: TrackingCarrier;
  url: string;
};

function compact(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function carrierFor(number: string): TrackingCarrier | null {
  if (/^1Z[A-Z0-9]{16}$/.test(number)) return "UPS";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(number)) return "USPS";
  if (/^9\d{19,21}$/.test(number)) return "USPS";
  if (/^\d{12}$/.test(number) || /^\d{15}$/.test(number)) return "FedEx";
  return null;
}

function trackingUrl(number: string, carrier: TrackingCarrier): string {
  const id = encodeURIComponent(number);
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${id}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${id}`;
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${id}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${number} tracking`)}`;
}

/** Public tracking page for a typed number. Dates and ordinary notes stay plain text. */
export function trackingLink(raw: string): TrackingLink | null {
  const text = raw.trim();
  if (!text || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) return null;
  const number = compact(text);
  if (number.length < 10 || number.length > 34) return null;
  if (!/\d{6,}/.test(number)) return null;
  const carrier = carrierFor(number) ?? "Google";
  return { number, carrier, url: trackingUrl(number, carrier) };
}
