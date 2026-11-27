import { downloadSharedDrivePdf, listSharedDrivePdfs } from "./driveFolderCore.js";

type VercelRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined> & { get?: (name: string) => string | null };
};

type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

function parseBody(raw: unknown): { action?: string; folder?: string; fileId?: string } {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as { action?: string; folder?: string; fileId?: string };
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as { action?: string; folder?: string; fileId?: string };
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as { action?: string; folder?: string; fileId?: string };
  return {};
}

function authHeader(headers: VercelRequest["headers"]): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get("authorization") ?? headers.get("Authorization") ?? undefined;
  const raw = headers.authorization ?? headers.Authorization;
  return Array.isArray(raw) ? raw[0] : raw;
}

async function verifySupabaseUser(header: string | undefined): Promise<void> {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required.");
  const url = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!response.ok) throw new Error("Invalid or expired session. Sign in again.");
}

export async function driveFolderResponse(body: { action?: string; folder?: string; fileId?: string }) {
  if (body.action === "file") {
    const bytes = await downloadSharedDrivePdf(String(body.fileId ?? ""));
    return { pdfBase64: Buffer.from(bytes).toString("base64") };
  }
  const files = await listSharedDrivePdfs(String(body.folder ?? ""));
  return { files };
}

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifySupabaseUser(authHeader(req.headers));
    return res.status(200).json(await driveFolderResponse(parseBody(req.body)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open that Drive folder.";
    const status = /Sign in|session/.test(message) ? 401 : 400;
    return res.status(status).json({ error: message });
  }
}

export default handler;
