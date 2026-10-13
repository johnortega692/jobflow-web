import type { IncomingMessage, ServerResponse } from "node:http";
import { runExtractGcSchedule, type GcScheduleAiPage } from "./extractGcScheduleCore";

/** Vite dev server middleware — uses ANTHROPIC_API_KEY from .env.local */
export function createExtractGcScheduleMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/extract-gc-schedule") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { pages?: GcScheduleAiPage[] };
          const result = await runExtractGcSchedule(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Import failed" }));
        }
      })();
    });
  };
}
