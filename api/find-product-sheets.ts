/** Vercel serverless — find and download manufacturer PDS / SDS PDFs. */

import { lookup } from "node:dns/promises";

type SheetKind = "product_data" | "sds";

export type ProductSheetQuery = {
  manufacturer?: string;
  product?: string;
  finish?: string;
  color?: string;
};

export type ProductSheetHit = {
  kind: SheetKind;
  title: string;
  url: string;
  source: string;
};

type FetchResult = {
  filename: string;
  pdfBase64: string;
};

type VercelRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

const MAX_SHEET_BYTES = 3_200_000;
const SEARCH_MODEL = "claude-sonnet-4-6";

function parseBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as Record<string, unknown>;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  return {};
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ipv4 = mapped?.[1] ?? host;
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4);
  if (!parts) return false;
  const nums = parts.slice(1).map((part) => Number(part));
  if (nums.some((n) => n > 255)) return true;
  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function publicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That link is not a valid web address.");
  }
  if (url.protocol !== "https:") throw new Error("Only https links can be downloaded.");
  if (url.username || url.password) throw new Error("That link is not allowed.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    isPrivateAddress(host)
  ) {
    throw new Error("That link is not allowed.");
  }
  let records: { address: string }[] = [];
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not open that link.");
  }
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("That link is not allowed.");
  }
  return url;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function readBody(res: Response, maxBytes: number, stopEarly: boolean): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      chunks.push(value);
      if (stopEarly && size >= maxBytes) break;
      if (!stopEarly && size > maxBytes) {
        throw new Error("This PDF is too large to attach from here. Open the link and upload it.");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1").includes("%PDF-");
}

async function fetchPdf(rawUrl: string, maxBytes: number, stopEarly: boolean): Promise<{ finalUrl: string; body: Buffer; contentType: string }> {
  const url = await publicHttpsUrl(rawUrl);
  const timeout = withTimeout(stopEarly ? 12_000 : 25_000);
  try {
    const response = await fetch(url.href, {
      redirect: "follow",
      signal: timeout.signal,
      headers: {
        Accept: "application/pdf,*/*",
        "User-Agent": "JobFlow/1.0 (product sheet lookup)",
      },
    });
    await publicHttpsUrl(response.url || url.href);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) return { finalUrl: response.url || url.href, body: Buffer.alloc(0), contentType };
    if (/text\/html|application\/json|text\/plain/i.test(contentType) && !/pdf/i.test(contentType)) {
      return { finalUrl: response.url || url.href, body: Buffer.alloc(0), contentType };
    }
    const body = await readBody(response, maxBytes, stopEarly);
    return { finalUrl: response.url || url.href, body, contentType };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This PDF")) throw error;
    if (error instanceof Error && /not allowed|not a valid|Could not open/.test(error.message)) throw error;
    throw new Error("Could not download that PDF.");
  } finally {
    timeout.done();
  }
}

const GENERIC_SHEET_WORDS = new Set([
  "paint",
  "paints",
  "coating",
  "coatings",
  "flat",
  "satin",
  "eggshell",
  "gloss",
  "semi",
  "sheen",
  "finish",
  "interior",
  "exterior",
  "primer",
  "vinyl",
  "latex",
  "acrylic",
  "white",
  "black",
  "base",
  "zero",
  "data",
  "sheet",
  "safety",
  "product",
  "company",
  "inc",
  "llc",
  "co",
  "and",
  "the",
]);

function significantWords(value: string): string[] {
  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !GENERIC_SHEET_WORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words)];
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textHasWord(value: string, word: string): boolean {
  return compactText(value).includes(word);
}

/** Keep a hit only when its link matches the manufacturer and its name matches the product. */
function sheetMatchesQuery(hit: { title: string; url: string }, query: ProductSheetQuery): boolean {
  const manufacturer = significantWords(query.manufacturer ?? "");
  const product = significantWords(query.product ?? "");
  if (manufacturer.length === 0 && product.length === 0) return false;
  let hostAndPath = "";
  try {
    const url = new URL(hit.url);
    hostAndPath = `${url.hostname} ${url.pathname}`;
  } catch {
    return false;
  }
  if (manufacturer.length > 0 && !manufacturer.some((word) => textHasWord(hostAndPath, word))) return false;
  if (product.length > 0 && !product.some((word) => textHasWord(`${hit.title} ${hostAndPath}`, word))) return false;
  return true;
}

function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function kindFrom(value: string, title: string, url: string): SheetKind {
  if (value === "sds" || value === "product_data") return value;
  return /\bsds\b|safety data|safety-data/i.test(`${title} ${url}`) ? "sds" : "product_data";
}

function filenameFor(url: string, title: string, kind: SheetKind): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    if (last.toLowerCase().endsWith(".pdf") && last.length <= 120 && !last.includes("..")) return last;
  } catch {
    /* use the title */
  }
  const fallback = title.trim() || (kind === "sds" ? "Safety Data Sheet" : "Product Data Sheet");
  const clean = fallback.replace(/[^\w .()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${clean || "sheet"}.pdf`;
}

function parseModelResults(text: string): { kind: string; title: string; url: string }[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { results?: unknown };
    if (!Array.isArray(parsed.results)) return [];
    return parsed.results.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as { kind?: unknown; title?: unknown; url?: unknown };
      const url = clip(item.url, 2000);
      if (!url) return [];
      return [{ kind: clip(item.kind, 40), title: clip(item.title, 180), url }];
    });
  } catch {
    return [];
  }
}

function pdfLinksFromSearch(content: { type?: string; content?: unknown }[]): { title: string; url: string }[] {
  const found: { title: string; url: string }[] = [];
  for (const block of content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const item of block.content) {
      if (!item || typeof item !== "object") continue;
      const row = item as { type?: string; title?: string; url?: string };
      if (row.type !== "web_search_result" || !row.url) continue;
      if (!/\.pdf(\?|$)/i.test(row.url)) continue;
      found.push({ title: clip(row.title, 180), url: clip(row.url, 2000) });
    }
  }
  return found;
}

export async function searchProductSheets(query: ProductSheetQuery): Promise<ProductSheetHit[]> {
  const manufacturer = clip(query.manufacturer, 160);
  const product = clip(query.product, 200);
  const finish = clip(query.finish, 120);
  const color = clip(query.color, 200);
  if (!manufacturer && !product) throw new Error("Enter a manufacturer or product first.");

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI assist is not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.",
    );
  }

  const prompt = `Find the official product data sheet (PDS or TDS) and safety data sheet (SDS) PDFs for this construction finish.

Manufacturer: ${manufacturer || "(not given)"}
Product: ${product || "(not given)"}
Finish: ${finish || "(not given)"}
Color or pattern: ${color || "(not given)"}

Rules:
- Prefer the manufacturer's own website.
- Return only direct PDF links that appeared in the search results.
- Do not invent, guess, or rewrite URLs.
- Every PDF must be for this manufacturer and this product. Skip other products, other brands, and generic company files.
- Skip catalog pages, HTML product pages, and login walls.
- At most 3 PDFs.

Reply with JSON only:
{"results":[{"kind":"product_data","title":"short name","url":"https://example.com/file.pdf"}]}
Use kind "sds" for a safety data sheet and "product_data" for a PDS or TDS.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const err = (await response.json()) as { error?: { message?: string } };
      detail = err.error?.message ?? "";
    } catch {
      /* ignore */
    }
    if (/web search/i.test(detail)) {
      throw new Error("Web search is not turned on for the AI key. Enable it in the Anthropic console, or upload the PDF.");
    }
    throw new Error(detail ? `AI search failed: ${detail.slice(0, 180)}` : "AI search failed.");
  }

  const data = (await response.json()) as {
    content?: { type?: string; text?: string; content?: unknown }[];
  };
  const content = data.content ?? [];
  const text = content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text ?? "")
    .join("\n");
  const candidates = [
    ...parseModelResults(text).map((row) => ({ kind: row.kind, title: row.title, url: row.url })),
    ...pdfLinksFromSearch(content).map((row) => ({ kind: "", title: row.title, url: row.url })),
  ];

  const seen = new Set<string>();
  const verified: ProductSheetHit[] = [];
  for (const candidate of candidates) {
    if (verified.length >= 4) break;
    const key = candidate.url.replace(/\/+$/, "").toLowerCase();
    if (!key || seen.has(key) || !sheetMatchesQuery(candidate, query)) continue;
    seen.add(key);
    try {
      const probe = await fetchPdf(candidate.url, 1024, true);
      if (!isPdf(probe.body)) continue;
      const kind = kindFrom(candidate.kind, candidate.title, probe.finalUrl);
      verified.push({
        kind,
        title: candidate.title || (kind === "sds" ? "Safety data sheet" : "Product data sheet"),
        url: probe.finalUrl,
        source: hostnameOf(probe.finalUrl),
      });
    } catch {
      /* drop links that are blocked or not a PDF */
    }
  }
  verified.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "product_data" ? -1 : 1));
  return verified;
}

export async function fetchProductSheetPdf(rawUrl: string, title = "", kind: SheetKind = "product_data"): Promise<FetchResult> {
  const downloaded = await fetchPdf(rawUrl, MAX_SHEET_BYTES, false);
  if (!isPdf(downloaded.body)) throw new Error("That link did not return a PDF. Open it and upload the file.");
  return {
    filename: filenameFor(downloaded.finalUrl, title, kind),
    pdfBase64: downloaded.body.toString("base64"),
  };
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required to use AI assist.");

  const url = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!response.ok) throw new Error("Invalid or expired session. Sign in again.");
}

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = req.headers?.authorization;
    await verifySupabaseUser(Array.isArray(auth) ? auth[0] : auth);
    const body = parseBody(req.body);
    if (body.action === "fetch") {
      const kind = body.kind === "sds" ? "sds" : "product_data";
      const file = await fetchProductSheetPdf(clip(body.url, 2000), clip(body.title, 180), kind);
      return res.status(200).json(file);
    }
    const results = await searchProductSheets({
      manufacturer: clip(body.manufacturer, 160),
      product: clip(body.product, 200),
      finish: clip(body.finish, 120),
      color: clip(body.color, 200),
    });
    return res.status(200).json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI search failed";
    const status = /Sign in|session/.test(message) ? 401 : /Enter a manufacturer|not configured|not allowed|too large|did not return/.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}

export default handler;
