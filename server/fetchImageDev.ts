import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchProductImage } from "../api/fetch-image";

/** Vite dev server middleware so packet PDFs can load product images. */
export function createFetchImageMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/fetch-image") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { url?: string };
          const image = await fetchProductImage(body.url ?? "");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(image));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not open that image link.";
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      })();
    });
  };
}
