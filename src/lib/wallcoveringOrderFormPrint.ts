import type { DeliverySchedulingSettings } from "./deliverySettings";
import { DEFAULT_DELIVERY_SCHEDULING } from "./deliverySettings";
import { wallcoveringOrderFormFilename } from "./pdfFilenames";
import { downloadOrderFormPdf, MATERIAL_PURCHASE_ORDER_TITLE } from "./orderFormPdf";
import type { PrintBranding } from "./printCore";
import type { WallcoveringItem } from "../types/tradeDocuments";

export type WcOrderFormItem = {
  label: string;
  manufacturer: string;
  product: string;
  color: string;
  quantity: string;
  unit: string;
  notes: string;
  vendor?: string;
};

export type WcOrderFormJob = {
  job_number: string;
  project_name: string;
  delivery_address: string;
  specifier: string;
  po_number?: string;
  items: WcOrderFormItem[];
};

export function wallcoveringItemsToOrderForm(
  items: WallcoveringItem[],
  vendor?: string,
): WcOrderFormItem[] {
  return items
    .filter((i) => i.manufacturer.trim() || i.product.trim() || i.label.trim())
    .map((i) => ({
      label: i.label,
      manufacturer: i.manufacturer,
      product: i.product,
      color: i.color,
      quantity: i.qty,
      unit: i.unit?.trim() || "EA",
      notes: i.notes,
      vendor,
    }));
}

export async function downloadWallcoveringOrderForm(
  job: WcOrderFormJob,
  branding: PrintBranding,
  deliverySettings: DeliverySchedulingSettings = DEFAULT_DELIVERY_SCHEDULING,
): Promise<void> {
  const po = job.po_number?.trim() ?? "";
  const filename = wallcoveringOrderFormFilename(job.project_name, job.job_number, po);
  await downloadOrderFormPdf({
    filename,
    branding,
    title: MATERIAL_PURCHASE_ORDER_TITLE,
    poNumber: po,
    infoRows: [
      { label: "Project", value: job.project_name },
      { label: "Delivery Address", value: job.delivery_address },
      { label: "Job Number", value: job.job_number },
      { label: "Specifier", value: job.specifier },
    ],
    detailsSectionTitle: "MATERIAL DETAILS",
    table: {
      columns: ["#", "Product", "Manufacturer", "Color/Pattern", "Qty", "Unit", "Notes"],
      colWeights: [5, 22, 16, 14, 10, 8, 25],
      aligns: ["left", "left", "left", "left", "right", "left", "left"],
      borders: "rows",
      padY: 9,
      headerPadY: 5,
      rows: job.items.map((item, i) => [
        String(i + 1),
        item.product,
        item.manufacturer,
        item.color,
        item.quantity,
        item.unit,
        item.notes,
      ]),
    },
    deliverySettings,
  });
}

/** @deprecated Use downloadWallcoveringOrderForm */
export const printWallcoveringOrderForm = downloadWallcoveringOrderForm;
