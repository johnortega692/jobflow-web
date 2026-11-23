import type { InvoiceLine } from "./types.ts";

/** Tab-separated rows for a Foundation invoice grid.
 * Columns from the Description cell: Description, Quantity, blank Unit of Measure, Unit Cost.
 */
export function foundationGridText(lines: Pick<InvoiceLine, "description" | "qty" | "netPrice">[]): string {
  return lines.map((line) => foundationGridCells(line).join("\t")).join("\r\n");
}

/** HTML table of the same cells, so Foundation can paste across columns the way it does from Excel. */
export function foundationGridHtml(lines: Pick<InvoiceLine, "description" | "qty" | "netPrice">[]): string {
  const rows = lines.map((line) => {
    const cells = foundationGridCells(line).map((cell) => `<td>${escapeGridHtml(cell)}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table>${rows}</table>`;
}

function foundationGridCells(line: Pick<InvoiceLine, "description" | "qty" | "netPrice">): string[] {
  const description = line.description.replace(/[\t\r\n]+/g, " ").trim();
  const qty = Number.isInteger(line.qty) ? String(line.qty) : String(line.qty);
  return [description, qty, "", line.netPrice.toFixed(2)];
}

function escapeGridHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
