import { authFetch } from "./apiAuth";
import type { SdsAttachmentKind } from "./sdsSectionModel";

export type ProductSheetHit = {
  kind: Extract<SdsAttachmentKind, "product_data" | "sds">;
  title: string;
  url: string;
  source: string;
};

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    const snippet = text.trim().slice(0, 160);
    throw new Error(snippet || `AI search failed (${res.status})`);
  }
}

export async function searchProductSheets(input: {
  manufacturer: string;
  product: string;
  finish: string;
  color: string;
}): Promise<ProductSheetHit[]> {
  const res = await authFetch("/api/find-product-sheets", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const body = await readJson<{ results?: ProductSheetHit[] }>(res);
  if (!res.ok) throw new Error(body.error ?? `AI search failed (${res.status})`);
  return (body.results ?? []).filter(
    (hit) => (hit.kind === "product_data" || hit.kind === "sds") && hit.url.startsWith("https://"),
  );
}

export async function downloadProductSheet(hit: ProductSheetHit): Promise<File> {
  const res = await authFetch("/api/find-product-sheets", {
    method: "POST",
    body: JSON.stringify({ action: "fetch", url: hit.url, title: hit.title, kind: hit.kind }),
  });
  const body = await readJson<{ filename?: string; pdfBase64?: string }>(res);
  if (!res.ok || !body.pdfBase64) throw new Error(body.error ?? "Could not download that PDF.");
  const binary = atob(body.pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const filename = (body.filename?.trim() || `${hit.title || "sheet"}.pdf`).replace(/[\\/]/g, " ");
  return new File([bytes], filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`, {
    type: "application/pdf",
  });
}
