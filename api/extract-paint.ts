import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runExtractPaint } from "./extractPaintCore";

type PaintBody = { image_base64?: string; media_type?: string };

function parseBody(raw: unknown): PaintBody {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    return raw as PaintBody;
  }
  if (typeof raw === "string" && raw.trim()) {
    return JSON.parse(raw) as PaintBody;
  }
  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString("utf8")) as PaintBody;
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await runExtractPaint(parseBody(req.body));
    return res.status(200).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";
    return res.status(500).json({ error: message });
  }
}
