/** Trigger a browser download — PDF bytes are not uploaded anywhere. */
export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const safeName = filename.trim() || "document.pdf";
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
