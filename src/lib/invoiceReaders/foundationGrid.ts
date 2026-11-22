import type { InvoiceLine } from "./types.ts";

/** Tab-separated rows for a Foundation invoice grid.
 * Paste on the Description cell: Description, Quantity, blank Unit of Measure, Unit Cost.
 */
export function foundationGridText(lines: Pick<InvoiceLine, "description" | "qty" | "netPrice">[]): string {
  return lines.map((line) => {
    const description = line.description.replace(/[\t\r\n]+/g, " ").trim();
    const qty = Number.isInteger(line.qty) ? String(line.qty) : String(line.qty);
    return [description, qty, "", line.netPrice.toFixed(2)].join("\t");
  }).join("\r\n");
}
