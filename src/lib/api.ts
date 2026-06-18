const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:8765";

export function getApiBaseUrl(): string {
  return base;
}

async function ensureApiReachable() {
  try {
    const res = await fetch(`${base}/health`, { method: "GET" });
    if (res.status === 405) {
      throw new Error(
        `Wrong app on ${base} (HTTP 405). Close it and run jobflow-web\\api\\dev.bat — JobFlow uses port 8765.`,
      );
    }
    if (!res.ok) {
      throw new Error(`PDF API error (${res.status}). Is api\\dev.bat running?`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("8765")) throw e;
    if (e instanceof Error && e.message.includes("405")) throw e;
    throw new Error(
      `PDF API is not running at ${base}. Double-click jobflow-web\\api\\dev.bat (port 8765).`,
    );
  }
}

export async function exportRfiPdf(project: Record<string, unknown>, rfi: Record<string, unknown>) {
  await ensureApiReachable();

  let res: Response;
  try {
    res = await fetch(`${base}/api/rfi/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, rfi }),
    });
  } catch {
    throw new Error(
      `Could not reach PDF API at ${base}. Start api\\dev.bat and try again.`,
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "RFI.pdf";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
