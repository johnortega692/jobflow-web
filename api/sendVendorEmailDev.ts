import type { IncomingMessage, ServerResponse } from "node:http";
import { runSendVendorEmail, verifySupabaseUser } from "./sendVendorEmailCore";

/** Vite dev handler for POST /api/send-vendor-email */
export function createSendVendorEmailMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/send-vendor-email")) {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const auth = req.headers.authorization;
          await verifySupabaseUser(auth);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = await runSendVendorEmail(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(JSON.stringify(result));
        } catch (e) {
          const message = e instanceof Error ? e.message : "Send failed";
          const status = message.includes("Sign in") || message.includes("session") ? 401 : 500;
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(JSON.stringify({ error: message }));
        }
      })();
    });
  };
}
