/** Vercel serverless — Claude reads a vendor invoice PDF. */

import { runReadInvoice } from "../server/readInvoiceCore.js";

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

function parseBody(raw: unknown): { pdf_base64?: string; vendor_name?: string } {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as { pdf_base64?: string; vendor_name?: string };
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as { pdf_base64?: string; vendor_name?: string };
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as { pdf_base64?: string; vendor_name?: string };
  return {};
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required to read an invoice.");

  const url = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
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
    const authStr = Array.isArray(auth) ? auth[0] : auth;
    await verifySupabaseUser(authStr);
    const result = await runReadInvoice(parseBody(req.body));
    return res.status(200).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read that invoice.";
    const status = message.includes("Sign in") || message.includes("session") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}

export default handler;
