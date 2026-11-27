import type { IncomingMessage, ServerResponse } from "node:http";
import { runReadInvoice } from "./readInvoiceCore";

/** Vite dev server middleware — uses ANTHROPIC_API_KEY from .env.local */
export function createReadInvoiceMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/read-invoice") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            pdf_base64?: string;
            vendor_name?: string;
          };
          const result = await runReadInvoice(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Could not read that invoice." }));
        }
      })();
    });
  };
}
