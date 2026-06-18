import type { IncomingMessage, ServerResponse } from "node:http";
import { runExtractPaint } from "./extractPaintCore";

/** Vite dev server middleware — uses ANTHROPIC_API_KEY from .env.local */
export function createExtractPaintMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/extract-paint") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            image_base64?: string;
            media_type?: string;
          };
          const result = await runExtractPaint(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Import failed" }));
        }
      })();
    });
  };
}
