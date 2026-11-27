import type { IncomingMessage, ServerResponse } from "node:http";
import { driveFolderResponse } from "../api/drive-folder";

/** Vite dev server middleware for the Invoice Check Drive folder. */
export function createDriveFolderMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split("?")[0];
    if (path !== "/api/drive-folder" || req.method !== "POST") {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const header = req.headers.authorization;
          const token = (Array.isArray(header) ? header[0] : header)?.replace(/^Bearer\s+/i, "").trim();
          if (!token) throw new Error("Sign in required.");
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action?: string; folder?: string; fileId?: string };
          const payload = await driveFolderResponse(body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not open that Drive folder.";
          res.statusCode = /Sign in|session/.test(message) ? 401 : 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      })();
    });
  };
}
