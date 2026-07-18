import type { DeliverySchedulingSettings } from "./deliverySettings";
import { DEFAULT_DELIVERY_SCHEDULING } from "./deliverySettings";
import { stripProductPrefix } from "./trackCatalog";
import { trackOrderFormFilename } from "./pdfFilenames";
import { downloadOrderFormPdf, MATERIAL_PURCHASE_ORDER_TITLE } from "./orderFormPdf";
import type { PrintBranding } from "./printCore";
import type { TrackItem } from "../types/tradeDocuments";

export type TrackOrderFormItem = {
  mat_code: string;
  product: string;
  quantity: string;
  unit: string;
};

export type TrackOrderFormJob = {
  job_number: string;
  project_name: string;
  delivery_address: string;
  specifier: string;
  manufacturer: string;
  po_number?: string;
  items: TrackOrderFormItem[];
};

export function trackItemsToOrderForm(items: TrackItem[]): TrackOrderFormItem[] {
  return items
    .filter((i) => i.product.trim() || i.mat_code.trim())
    .map((i) => ({
      mat_code: i.mat_code,
      product: stripProductPrefix(i.product),
      quantity: i.quantity,
      unit: i.unit?.trim() || "EA",
    }));
}

export async function downloadTrackOrderForm(
  job: TrackOrderFormJob,
  branding: PrintBranding,
  deliverySettings: DeliverySchedulingSettings = DEFAULT_DELIVERY_SCHEDULING,
): Promise<void> {
  const po = job.po_number?.trim() ?? "";
  const filename = trackOrderFormFilename(job.project_name, job.job_number, po);
  await downloadOrderFormPdf({
    filename,
    branding,
    title: MATERIAL_PURCHASE_ORDER_TITLE,
    poNumber: po,
    infoRows: [
      { label: "Project", value: job.project_name },
      { label: "Job Number", value: job.job_number },
      { label: "Delivery Address", value: job.delivery_address },
      { label: "Specifier", value: job.specifier },
      { label: "Manufacturer", value: job.manufacturer },
    ],
    detailsSectionTitle: "ORDER DETAILS",
    table: {
      columns: ["#", "Mat. code", "Product", "Qty", "Unit"],
      // ~6% / 16% / 48% / 15% / 15% (4-col 6/18/56/20 with Unit added)
      colWeights: [6, 16, 48, 15, 15],
      aligns: ["left", "left", "left", "right", "left"],
      borders: "rows",
      padY: 9,
      headerPadY: 5,
      rows: job.items.map((item, i) => [
        String(i + 1),
        item.mat_code,
        item.product,
        item.quantity,
        item.unit,
      ]),
    },
    deliverySettings,
  });
}

/** @deprecated Use downloadTrackOrderForm */
export const printTrackOrderForm = downloadTrackOrderForm;
