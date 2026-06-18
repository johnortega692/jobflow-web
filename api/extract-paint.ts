import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runExtractPaint } from "./extractPaintCore";

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
    const result = await runExtractPaint(req.body as { image_base64?: string; media_type?: string });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : "Import failed" });
  }
}
