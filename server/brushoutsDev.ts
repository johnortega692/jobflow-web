import type { IncomingMessage, ServerResponse } from "node:http";

/** Vite dev proxy for BrushOuts Google Apps Script POST (avoids browser CORS). */
export function createBrushoutsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/brushouts") || req.method !== "POST") {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            url?: string;
            payload?: unknown;
          };
          const target = (body.url || "").trim();
          if (!target) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing BrushOuts URL" }));
            return;
          }
          const upstream = await fetch(`${target}?sheet=brushouts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body.payload ?? {}),
          });
          const text = await upstream.text();
          res.statusCode = upstream.ok ? 200 : upstream.status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: upstream.ok, status: upstream.status, body: text }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "BrushOuts proxy failed" }));
        }
      })();
    });
  };
}
