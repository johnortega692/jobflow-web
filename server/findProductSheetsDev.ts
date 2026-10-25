import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchProductSheetPdf, searchProductSheets } from "../api/find-product-sheets";

/** Vite dev server middleware — uses ANTHROPIC_API_KEY from .env.local */
export function createFindProductSheetsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/find-product-sheets") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            action?: string;
            url?: string;
            title?: string;
            kind?: string;
            manufacturer?: string;
            product?: string;
            finish?: string;
            color?: string;
          };
          const result =
            body.action === "fetch"
              ? await fetchProductSheetPdf(body.url ?? "", body.title ?? "", body.kind === "sds" ? "sds" : "product_data")
              : { results: await searchProductSheets(body) };
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI search failed";
          res.statusCode = /Enter a manufacturer|not configured|not allowed|too large|did not return/.test(message) ? 400 : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      })();
    });
  };
}
