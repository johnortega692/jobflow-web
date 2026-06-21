function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read logo image."));
    reader.readAsDataURL(blob);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inline logo as a data URI so Gmail and other clients show it without loading external URLs. */
export async function embedLogoUrlInHtml(html: string, logoUrl: string): Promise<string> {
  const url = logoUrl.trim();
  if (!url || !html.trim()) return html;
  if (url.startsWith("data:")) return html;

  try {
    const res = await fetch(url);
    if (!res.ok) return html;
    const blob = await res.blob();
    if (!blob.size) return html;
    const dataUrl = await blobToDataUrl(blob);
    let out = html.replace(/cid:logo_image/gi, dataUrl);
    out = out.split(url).join(dataUrl);
    const encodedUrl = escapeRegExp(url);
    out = out.replace(new RegExp(encodedUrl, "g"), dataUrl);
    return out;
  } catch {
    return html;
  }
}
