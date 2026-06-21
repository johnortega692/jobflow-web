import type { IncomingMessage, ServerResponse } from "node:http";
import { runRfiAssist, type RfiAssistRequest } from "./rfiAssistCore";

/** Vite dev server middleware — uses ANTHROPIC_API_KEY from .env.local */
export function createRfiAssistMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/rfi-assist") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RfiAssistRequest;
          const result = await runRfiAssist(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "AI assist failed" }));
        }
      })();
    });
  };
}
