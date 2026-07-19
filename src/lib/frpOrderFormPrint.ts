import type { DeliverySchedulingSettings } from "./deliverySettings";
import { DEFAULT_DELIVERY_SCHEDULING } from "./deliverySettings";
import type { FrpCatalog } from "./frpCatalog";
import { frpIsTrimProduct } from "./frpCatalog";
import { frpOrderFormFilename } from "./pdfFilenames";
import { downloadOrderFormPdf, MATERIAL_PURCHASE_ORDER_TITLE } from "./orderFormPdf";
import type { PrintBranding } from "./printCore";
import type { FrpItem } from "../types/tradeDocuments";

export type FrpOrderFormItem = {
  manufacturer: string;
  product: string;
  color: string;
  panel_size: string;
  trim_size: string;
  quantity: string;
  unit: string;
  notes: string;
};

export type FrpOrderFormJob = {
  job_number: string;
  project_name: string;
  delivery_address: string;
  specifier: string;
  po_number?: string;
  items: FrpOrderFormItem[];
};

export function frpItemsToOrderForm(
  items: FrpItem[],
  catalog: FrpCatalog,
): FrpOrderFormItem[] {
  return items
    .filter((i) => i.manufacturer.trim() || i.product.trim() || i.label.trim())
    .map((i) => {
      const isTrim = frpIsTrimProduct(catalog, i.manufacturer, i.product);
      return {
        manufacturer: i.manufacturer,
        product: i.product,
        color: i.color,
        panel_size: isTrim ? "" : i.panel_size,
        trim_size: isTrim ? i.trim_size : "",
        quantity: i.quantity,
        unit: i.unit?.trim() || "EA",
        notes: i.notes.trim(),
      };
    });
}

export async function downloadFrpOrderForm(
  job: FrpOrderFormJob,
  branding: PrintBranding,
  deliverySettings: DeliverySchedulingSettings = DEFAULT_DELIVERY_SCHEDULING,
): Promise<void> {
  const po = job.po_number?.trim() ?? "";
  const filename = frpOrderFormFilename(job.project_name, job.job_number, po);
  const includeNotes = job.items.some((item) => item.notes.trim());
  await downloadOrderFormPdf({
    filename,
    branding,
    title: MATERIAL_PURCHASE_ORDER_TITLE,
    poNumber: po,
    landscape: true,
    narrowMargins: true,
    infoRows: [
      { label: "Project", value: job.project_name },
      { label: "Delivery Address", value: job.delivery_address },
      { label: "Job Number", value: job.job_number },
      { label: "Specifier", value: job.specifier },
    ],
    detailsSectionTitle: "ORDER DETAILS",
    table: {
      columns: includeNotes
        ? ["#", "Product", "Manufacturer", "Color", "Panel Size", "Length", "Qty", "Unit", "Notes"]
        : ["#", "Product", "Manufacturer", "Color", "Panel Size", "Length", "Qty", "Unit"],
      colWeights: includeNotes
        ? [3, 28, 22, 10, 8, 6, 4, 5, 14]
        : [3, 34, 28, 11, 8, 6, 4, 6],
      aligns: includeNotes
        ? ["left", "left", "left", "left", "left", "left", "right", "left", "left"]
        : ["left", "left", "left", "left", "left", "left", "right", "left"],
      borders: "rows",
      padY: 9,
      headerPadY: 5,
      fontSize: 10,
      rows: job.items.map((item, i) => {
        const base = [
          String(i + 1),
          item.product,
          item.manufacturer,
          item.color,
          item.panel_size,
          item.trim_size,
          item.quantity,
          item.unit,
        ];
        return includeNotes ? [...base, item.notes.trim()] : base;
      }),
    },
    deliverySettings,
  });
}

/** @deprecated Use downloadFrpOrderForm */
export const printFrpOrderForm = downloadFrpOrderForm;
