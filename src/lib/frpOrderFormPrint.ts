import { esc, formatLongDate, logoBlock, printHtml, type PrintBranding } from "./printCore";
import { frpOrderFormFilename, pdfTitleFromFilename } from "./pdfFilenames";
import type { DeliverySchedulingSettings } from "./deliverySettings";
import { DEFAULT_DELIVERY_SCHEDULING } from "./deliverySettings";
import type { FrpCatalog } from "./frpCatalog";
import { frpIsTrimProduct } from "./frpCatalog";
import type { FrpItem } from "../types/tradeDocuments";

const ORDER_FORM_CSS = `
@page { size: letter; margin: 0.5in 0.55in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; padding: 0 40px 30px; }
.company-logo { text-align: center; margin-bottom: 5px; }
.company-logo img { max-width: 400px; height: auto; }
.company-info { text-align: center; font-size: 9pt; margin-bottom: 10px; }
.header-line { border-bottom: 2px solid #000; margin-bottom: 8px; }
.date-section { font-size: 10pt; margin-bottom: 20px; }
.form-title { text-align: center; font-size: 16pt; font-weight: bold; text-decoration: underline; margin-bottom: 25px; }
.project-info { margin-bottom: 25px; }
.info-row { margin-bottom: 6px; font-size: 11pt; }
.section-title { background: #f0f0f0; color: #000; padding: 8px 12px; font-weight: bold; font-size: 12pt; margin: 20px 0 15px; border-left: 4px solid #333; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
table th { background: #333; color: #fff; padding: 10px; text-align: left; font-size: 10pt; }
table td { padding: 8px 10px; border: 1px solid #ddd; vertical-align: top; }
table tr:nth-child(even) { background: #f9f9f9; }
.delivery-block { margin-top: 15px; font-size: 11pt; line-height: 1.5; }
.footer { margin-top: 30px; font-size: 10.5pt; }
.empty-state { text-align: center; color: #999; font-style: italic; padding: 30px; }
`;

export type FrpOrderFormItem = {
  manufacturer: string;
  product: string;
  color: string;
  panel_size: string;
  trim_size: string;
  quantity: string;
  notes: string;
};

export type FrpOrderFormJob = {
  job_number: string;
  project_name: string;
  delivery_address: string;
  specifier: string;
  items: FrpOrderFormItem[];
};

function orderRows(items: FrpOrderFormItem[]): string {
  return items
    .map(
      (item, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(item.product)}</strong></td>
      <td>${esc(item.manufacturer)}</td>
      <td>${esc(item.color)}</td>
      <td>${esc(item.panel_size)}</td>
      <td>${esc(item.trim_size)}</td>
      <td>${esc(item.quantity)}</td>
      <td>${esc(item.notes)}</td>
    </tr>`,
    )
    .join("");
}

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
        notes: i.notes,
      };
    });
}

export function buildFrpOrderFormHtml(
  job: FrpOrderFormJob,
  branding: PrintBranding,
  deliverySettings: DeliverySchedulingSettings = DEFAULT_DELIVERY_SCHEDULING,
  saveFilename?: string,
): string {
  const ds = deliverySettings;
  const bodyRows =
    job.items.length === 0
      ? `<div class="empty-state">No items have been added to this order form yet.</div>`
      : `<table>
        <thead><tr>
          <th style="width:4%">#</th>
          <th style="width:18%">Product</th>
          <th style="width:14%">Manufacturer</th>
          <th style="width:12%">Color</th>
          <th style="width:10%">Panel Size</th>
          <th style="width:10%">Length</th>
          <th style="width:10%">Quantity</th>
          <th style="width:22%">Notes</th>
        </tr></thead>
        <tbody>${orderRows(job.items)}</tbody>
      </table>`;

  const pageTitle = pdfTitleFromFilename(saveFilename ?? "FRP_Order_Form");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(pageTitle)}</title><style>${ORDER_FORM_CSS}</style></head><body>
  <div class="company-logo">${logoBlock(branding)}</div>
  <div class="header-line"></div>
  <div class="company-info">${esc(branding.companyContactLine || branding.companyInfo)}</div>
  <div class="date-section">${esc(formatLongDate())}</div>
  <div class="form-title">Purchase Order Form</div>
  <div class="project-info">
    <p class="info-row">Project: ${esc(job.project_name)}</p>
    <p class="info-row">Delivery Address: ${esc(job.delivery_address)}</p>
    <p class="info-row">Job Number: ${esc(job.job_number)}</p>
    <p class="info-row">Specifier: ${esc(job.specifier)}</p>
  </div>
  <div class="section-title">ORDER DETAILS</div>
  ${bodyRows}
  <div class="section-title">DELIVERY SCHEDULING INFORMATION</div>
  <div class="delivery-block">
    <strong>Warehouse Contact Info:</strong><br>
    &nbsp;&nbsp;o&nbsp;&nbsp;${esc(ds.warehouse_contact_name)} - <a href="mailto:${esc(ds.warehouse_contact_email)}">${esc(ds.warehouse_contact_email)}</a> - Cell: ${esc(ds.warehouse_contact_cell)}<br>
    &nbsp;&nbsp;o&nbsp;&nbsp;Main Office: ${esc(ds.warehouse_main_office)}<br>
    <strong>Receiving Hours:</strong> ${esc(ds.receiving_hours)}<br>
    <strong>Dock Restrictions:</strong> ${esc(ds.dock_restrictions)}<br>
    <strong>Is a lift gate needed?</strong> ${esc(ds.lift_gate_needed)}<br><br>
    ${esc(ds.closing_note)}
  </div>
  <div class="footer">
    <p><strong>Thank you,</strong></p><p>&nbsp;</p>
    <p>${esc(branding.footerName)}</p>
    <p>${esc(branding.footerPhone)}</p>
    ${branding.footerEmail ? `<p><a href="mailto:${esc(branding.footerEmail)}">${esc(branding.footerEmail)}</a></p>` : ""}
  </div>
</body></html>`;
}

export function printFrpOrderForm(
  job: FrpOrderFormJob,
  branding: PrintBranding,
  deliverySettings?: DeliverySchedulingSettings,
): void {
  const filename = frpOrderFormFilename(job.project_name, job.job_number);
  printHtml(
    buildFrpOrderFormHtml(job, branding, deliverySettings, filename),
    pdfTitleFromFilename(filename),
    branding.logoUrl,
  );
}
