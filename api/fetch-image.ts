/** Vercel serverless — load a product image so the packet PDF can draw it. */

import { lookup } from "node:dns/promises";

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

const MAX_IMAGE_BYTES = 2_500_000;

function parseBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as Record<string, unknown>;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  return {};
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
  if (url.protocol !== "https:") throw new Error("Only https image links can be loaded.");
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
    throw new Error("Could not open that image link.");
  }
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("That link is not allowed.");
  }
  return url;
}

function imageContentType(buf: Buffer, header: string): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("image/") && type !== "image/svg+xml") return type;
  return null;
}

export async function fetchProductImage(rawUrl: string): Promise<{ contentType: string; imageBase64: string }> {
  const url = await publicHttpsUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
        "User-Agent": "JobFlow/1.0 (product image)",
      },
    });
    await publicHttpsUrl(response.url || url.href);
    if (!response.ok || !response.body) throw new Error("Could not open that image link.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error("That image is too large to place on the card.");
        chunks.push(value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const contentType = imageContentType(body, response.headers.get("content-type") ?? "");
    if (!contentType) throw new Error("That link is not an image.");
    return { contentType, imageBase64: body.toString("base64") };
  } catch (error) {
    if (error instanceof Error && /not allowed|not a valid|Could not open|not an image|too large/.test(error.message)) {
      throw error;
    }
    throw new Error("Could not open that image link.");
  } finally {
    clearTimeout(timer);
  }
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required.");

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
    const image = await fetchProductImage(String(body.url ?? ""));
    return res.status(200).json(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open that image link.";
    const status = /Sign in|session/.test(message) ? 401 : 400;
    return res.status(status).json({ error: message });
  }
}

export default handler;
