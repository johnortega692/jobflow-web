import { isSupabaseAdminConfigured } from "../src/lib/supabaseAdmin.js";
import { saveTrackerEmailCronStatusAdmin } from "../src/lib/orgSettingsAdmin.js";
import { buildTrackerEmailCronStatus } from "../src/lib/trackerEmailCronStatus.js";
import { resolveTrackerCronSlots, type TrackerEmailCronSlot } from "../src/lib/trackerEmailSchedule.js";

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

type CronRunResult = {
  slot: TrackerEmailCronSlot;
  usersProcessed: number;
  sent: string[];
  skipped: string[];
  errors: { userId: string; message: string }[];
};

function readHeader(req: VercelRequest, name: string): string {
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

function readQuery(req: VercelRequest, name: string): string {
  const raw = req.query?.[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

function isVercelCronRequest(req: VercelRequest): boolean {
  const ua = readHeader(req, "user-agent");
  if (ua.toLowerCase().includes("vercel-cron/")) return true;
  if (readHeader(req, "x-vercel-cron") === "1") return true;
  return Boolean(readHeader(req, "x-vercel-cron-schedule").trim());
}

function verifyCronSecret(req: VercelRequest): boolean {
  if (isVercelCronRequest(req)) return true;
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const auth = readHeader(req, "authorization");
  if (auth === `Bearer ${secret}`) return true;
  return readQuery(req, "secret") === secret;
}

function parseSlots(req: VercelRequest): TrackerEmailCronSlot[] {
  return resolveTrackerCronSlots({
    querySlot: readQuery(req, "slot"),
    cronScheduleHeader: readHeader(req, "x-vercel-cron-schedule"),
  });
}

function mergeCronResults(
  slots: TrackerEmailCronSlot[],
  results: CronRunResult[],
): Omit<CronRunResult, "slot"> & { slots: TrackerEmailCronSlot[] } {
  return {
    slots,
    usersProcessed: results.reduce((max, row) => Math.max(max, row.usersProcessed), 0),
    sent: results.flatMap((row) => row.sent),
    skipped: results.flatMap((row) => row.skipped),
    errors: results.flatMap((row) => row.errors),
  };
}

async function persistCronStatus(
  status: ReturnType<typeof buildTrackerEmailCronStatus>,
): Promise<string | null> {
  try {
    await saveTrackerEmailCronStatusAdmin(status);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not save cron status";
  }
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({
      error: "Unauthorized",
      hint: "Set CRON_SECRET on Vercel. Cron requests send Authorization: Bearer <CRON_SECRET>.",
    });
  }

  if (!isSupabaseAdminConfigured()) {
    return res.status(500).json({
      error: "Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL for tracker email cron.",
    });
  }

  try {
    const { runTrackerEmailCron } = await import("../src/lib/trackerEmailCronCore.js");
    const { runPinLockoutNotify } = await import("../src/lib/pinLockoutNotifyCore.js");
    const slots = parseSlots(req);
    const results: CronRunResult[] = [];
    for (const slot of slots) {
      results.push(await runTrackerEmailCron(slot));
    }
    const merged = mergeCronResults(slots, results);
    const status = buildTrackerEmailCronStatus({
      source: "automatic",
      slots,
      sent: merged.sent,
      skipped: merged.skipped,
      errors: merged.errors,
      ok: merged.errors.length === 0,
    });
    const statusSaveError = await persistCronStatus(status);

    let pinLockout: Awaited<ReturnType<typeof runPinLockoutNotify>> | undefined;
    if (slots.includes("daily")) {
      try {
        pinLockout = await runPinLockoutNotify();
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e instanceof Error ? e.message : "PIN lockout notify failed",
          tracker: merged,
          status,
          statusSaveError,
        });
      }
    }
    return res.status(200).json({ ok: true, ...merged, pinLockout, status, statusSaveError });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tracker email cron failed";
    const status = buildTrackerEmailCronStatus({
      source: "automatic",
      ok: false,
      errors: [{ message }],
      message,
    });
    const statusSaveError = await persistCronStatus(status);
    return res.status(500).json({
      ok: false,
      error: message,
      statusSaveError,
    });
  }
}

export default handler;
