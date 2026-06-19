import type { WallcoveringItem } from "../types/tradeDocuments";

export type WcSampleOrderItem = {
  manufacturer: string;
  product: string;
  color: string;
  qty: string;
};

function firstName(vendor: string): string {
  const word = vendor.trim().split(/\s+/)[0];
  return word || "Team";
}

export function buildWcSampleOrderEmail(params: {
  vendor: string;
  jobNumber: string;
  jobName: string;
  architect: string;
  shippingAddress: string;
  items: WcSampleOrderItem[];
}): { subject: string; body: string } {
  const greeting = `Dear ${firstName(params.vendor)},`;
  const lines = [`${greeting}`, "", "I hope this email finds you well. We have been awarded Project " +
    `${params.jobNumber} - ${params.jobName} and would like to request material samples.`, "", "Requested Items", ""];

  params.items.forEach((item, i) => {
    let line = `${i + 1}. ${item.manufacturer} - `;
    if (item.color.trim()) line += `${item.product} - Color: ${item.color}`;
    else line += item.product;
    if (item.qty.trim()) line += ` (Qty: ${item.qty})`;
    lines.push(line);
  });

  if (params.architect.trim()) {
    lines.push("", `Specifier: ${params.architect.trim()}`);
  }

  const address =
    params.shippingAddress.trim() ||
    "[Please provide address for sample delivery]";
  lines.push(
    "",
    "Please ship samples to the following:",
    address,
    "",
    "Thank you for your assistance.",
  );

  return {
    subject: `Sample Request - ${params.jobNumber} ${params.jobName}`,
    body: lines.join("\n"),
  };
}

export function orderedWallcoveringItems(items: WallcoveringItem[]): WcSampleOrderItem[] {
  return items
    .filter((i) => i.order && (i.manufacturer.trim() || i.product.trim() || i.color.trim()))
    .map((i) => ({
      manufacturer: i.manufacturer,
      product: i.product,
      color: i.color,
      qty: i.qty,
    }));
}

export const WC_SHIPPING_ADDRESS_KEY = "jobflow_wc_shipping_address";

export function loadWcShippingAddress(): string {
  try {
    return localStorage.getItem(WC_SHIPPING_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveWcShippingAddress(address: string): void {
  try {
    localStorage.setItem(WC_SHIPPING_ADDRESS_KEY, address);
  } catch {
    /* ignore */
  }
}
