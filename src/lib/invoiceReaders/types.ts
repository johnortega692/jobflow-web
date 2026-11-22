export type PdfRow = { x: number; str: string }[];

export type InvoiceLine = {
  salesNumber: string;
  size: string;
  productId: string;
  description: string;
  color: string;
  qty: number;
  listPrice: number;
  discountAmount: number;
  discountPercent: number | null;
  netPrice: number;
  section: "sundry" | "paint_product";
  sheen: string | null;
  /** Fees stay on the vendor bill and stay out of the catalog compare. */
  catalogItem?: boolean;
};

export type ParsedInvoice = {
  readerId: string;
  vendorName: string;
  invoiceNo: string;
  invoiceDate: string;
  /** Printed "PAGE n OF m" total. One PDF can hold several invoices. */
  pageCount: number;
  firstPage: number;
  lastPage: number;
  lines: InvoiceLine[];
  /** Amount due, including tax. */
  total: number | null;
  /** Printed sales-tax rate. Inferred from the tax amount when the invoice omits it. */
  taxPercent: number | null;
};

export type ParsedInvoiceFile = {
  vendorName: string;
  invoices: ParsedInvoice[];
};

/** Product code from the invoice, or the sales number when that column is blank. */
export function invoiceProductCode(line: InvoiceLine): string {
  return line.productId.trim() || line.salesNumber.trim();
}

export type InvoiceReader = {
  id: string;
  vendorName: string;
  detect: (text: string) => boolean;
  parse: (rows: PdfRow[]) => ParsedInvoice | null;
};
