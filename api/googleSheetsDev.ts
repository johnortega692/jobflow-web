import type { IncomingMessage, ServerResponse } from "node:http";

/** Vite dev proxy for Google Apps Script GET/POST (avoids browser CORS). */
export function createGoogleSheetsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/google-sheets") || req.method !== "POST") {
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
            method?: "GET" | "POST";
            query?: Record<string, string>;
            payload?: unknown;
          };
          const target = (body.url || "").trim().replace(/\?.*$/, "");
          if (!target) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing Google Apps Script URL" }));
            return;
          }

          const fetchUrl = new URL(target);
          if (body.query) {
            for (const [key, value] of Object.entries(body.query)) {
              fetchUrl.searchParams.set(key, String(value));
            }
          }

          const upstream = await fetch(fetchUrl.toString(), {
            method: body.method ?? "POST",
            headers: body.method === "GET" ? undefined : { "Content-Type": "application/json" },
            body: body.method === "GET" ? undefined : JSON.stringify(body.payload ?? {}),
          });
          const text = await upstream.text();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: upstream.ok,
              status: upstream.status,
              body: text,
            }),
          );
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Google Sheets proxy failed" }));
        }
      })();
    });
  };
}
