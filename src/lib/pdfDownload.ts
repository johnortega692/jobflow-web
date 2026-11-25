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

/** Open the system print dialog for a PDF. Falls back to a download if the dialog cannot open. */
export function printPdfBytes(bytes: Uint8Array, filename = "document.pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "none";
  frame.src = url;
  document.body.appendChild(frame);
  const cleanup = () => {
    URL.revokeObjectURL(url);
    frame.remove();
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      downloadPdfBytes(bytes, filename);
      return;
    }
    win.focus();
    win.print();
    win.addEventListener("afterprint", cleanup, { once: true });
  };
}
