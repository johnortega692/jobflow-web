import { isSupabaseAdminConfigured } from "../src/lib/supabaseAdmin";
import { runPinLockoutNotify } from "../src/lib/pinLockoutNotifyCore";
import { runTrackerEmailCron, type CronRunResult } from "../src/lib/trackerEmailCronCore";
import type { TrackerEmailCronSlot } from "../src/lib/trackerEmailSchedule";

type VercelRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

function readAuthHeader(req: VercelRequest): string {
  const auth = req.headers?.authorization;
  return (Array.isArray(auth) ? auth[0] : auth) ?? "";
}

function verifyCronSecret(req: VercelRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const auth = readAuthHeader(req);
  if (auth === `Bearer ${secret}`) return true;
  const querySecret = req.query?.secret;
  const q = Array.isArray(querySecret) ? querySecret[0] : querySecret;
  return typeof q === "string" && q === secret;
}

function parseSlot(req: VercelRequest): TrackerEmailCronSlot {
  const slot = req.query?.slot;
  const value = Array.isArray(slot) ? slot[0] : slot;
  return value === "weekly" ? "weekly" : "daily";
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isSupabaseAdminConfigured()) {
    return res.status(500).json({
      error: "Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL for tracker email cron.",
    });
  }

  try {
    const slot = parseSlot(req);
    const result: CronRunResult = await runTrackerEmailCron(slot);
    let pinLockout: Awaited<ReturnType<typeof runPinLockoutNotify>> | undefined;
    if (slot === "daily") {
      try {
        pinLockout = await runPinLockoutNotify();
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e instanceof Error ? e.message : "PIN lockout notify failed",
          tracker: result,
        });
      }
    }
    return res.status(200).json({ ok: true, ...result, pinLockout });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : "Tracker email cron failed",
    });
  }
}

export default handler;
