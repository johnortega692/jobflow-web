type GoogleSheetsProxyRequest = {
  url?: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  payload?: unknown;
};

type GoogleSheetsProxyResponse = {
  ok?: boolean;
  status?: number;
  body?: string;
  error?: string;
};

/** Server-side proxy to Google Apps Script (avoids browser CORS in production). */
export async function googleSheetsProxy(req: GoogleSheetsProxyRequest): Promise<GoogleSheetsProxyResponse> {
  const res = await fetch("/api/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleSheetsProxyResponse;
  if (!res.ok) throw new Error(json.error ?? `Google Sheets request failed (${res.status})`);
  return json;
}

export async function googleSheetsGet(
  baseUrl: string,
  query: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const clean = baseUrl.trim().replace(/\?.*$/, "");
  if (!clean) throw new Error("Google Sheets URL not configured in Settings.");

  const proxy = await googleSheetsProxy({ url: clean, method: "GET", query });
  const text = proxy.body ?? "";
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: proxy.status ?? 200, json, text };
}

export async function googleSheetsPost(
  baseUrl: string,
  payload: unknown,
  query?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const clean = baseUrl.trim().replace(/\?.*$/, "");
  if (!clean) throw new Error("Google Sheets URL not configured in Settings.");

  const proxy = await googleSheetsProxy({ url: clean, method: "POST", query, payload });
  const text = proxy.body ?? "";
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: proxy.status ?? 200, json, text };
}
