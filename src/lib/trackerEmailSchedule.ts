export type TrackerEmailCronSlot = "daily" | "weekly" | "monday";

/** JS `Date.getUTCDay()` — Sunday = 0 … Saturday = 6. */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DEFAULT_DIGEST_WEEKDAY = 5;
export const DEFAULT_SITE_READY_WEEKDAY = 1;

export type TrackerEmailSchedule = {
  /** Master switch for Vercel cron sends for this account. */
  enabled: boolean;
  /** Used for follow-up "due today" date bucketing when cron runs. */
  timezone: string;
  daily: {
    enabled: boolean;
    paint_followup: boolean;
    wallcovering_followup: boolean;
    installs: boolean;
    /** Per-job email to ICBI PM 4 days before Billing Due day. */
    billing_due: boolean;
  };
  weekly: {
    enabled: boolean;
    /** Combined paint + wallcovering submittal digest (Friday-style). */
    combined_digest: boolean;
    wallcovering_digest: boolean;
    /** Site-ready gates + Needs attention — Monday cron slot. */
    startup_site_ready: boolean;
    /** UTC weekday (0–6) to send combined / wallcovering digests. */
    digest_weekday: number;
    /** UTC weekday (0–6) to send site-ready + Needs attention. */
    site_ready_weekday: number;
  };
};

export const DEFAULT_TRACKER_EMAIL_SCHEDULE: TrackerEmailSchedule = {
  enabled: false,
  timezone: "America/Los_Angeles",
  daily: {
    enabled: false,
    paint_followup: true,
    wallcovering_followup: true,
    installs: true,
    billing_due: true,
  },
  weekly: {
    enabled: false,
    combined_digest: true,
    wallcovering_digest: false,
    startup_site_ready: true,
    digest_weekday: DEFAULT_DIGEST_WEEKDAY,
    site_ready_weekday: DEFAULT_SITE_READY_WEEKDAY,
  },
};

export function normalizeWeekday(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 6) return fallback;
  return n;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[normalizeWeekday(weekday, DEFAULT_DIGEST_WEEKDAY)] ?? "Friday";
}

export function normalizeTrackerEmailSchedule(raw: unknown): TrackerEmailSchedule {
  const base = {
    ...DEFAULT_TRACKER_EMAIL_SCHEDULE,
    daily: { ...DEFAULT_TRACKER_EMAIL_SCHEDULE.daily },
    weekly: { ...DEFAULT_TRACKER_EMAIL_SCHEDULE.weekly },
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  if (typeof o.enabled === "boolean") base.enabled = o.enabled;
  if (typeof o.timezone === "string" && o.timezone.trim()) base.timezone = o.timezone.trim();

  let legacyWeeklyBillingDue: boolean | undefined;

  if (o.daily && typeof o.daily === "object" && !Array.isArray(o.daily)) {
    const d = o.daily as Record<string, unknown>;
    if (typeof d.enabled === "boolean") base.daily.enabled = d.enabled;
    if (typeof d.paint_followup === "boolean") base.daily.paint_followup = d.paint_followup;
    if (typeof d.wallcovering_followup === "boolean") {
      base.daily.wallcovering_followup = d.wallcovering_followup;
    }
    if (typeof d.installs === "boolean") base.daily.installs = d.installs;
    if (typeof d.billing_due === "boolean") base.daily.billing_due = d.billing_due;
  }

  if (o.weekly && typeof o.weekly === "object" && !Array.isArray(o.weekly)) {
    const w = o.weekly as Record<string, unknown>;
    if (typeof w.enabled === "boolean") base.weekly.enabled = w.enabled;
    if (typeof w.combined_digest === "boolean") base.weekly.combined_digest = w.combined_digest;
    if (typeof w.wallcovering_digest === "boolean") {
      base.weekly.wallcovering_digest = w.wallcovering_digest;
    }
    if (typeof w.startup_site_ready === "boolean") {
      base.weekly.startup_site_ready = w.startup_site_ready;
    }
    if (typeof w.billing_due === "boolean") legacyWeeklyBillingDue = w.billing_due;
    base.weekly.digest_weekday = normalizeWeekday(w.digest_weekday, DEFAULT_DIGEST_WEEKDAY);
    base.weekly.site_ready_weekday = normalizeWeekday(w.site_ready_weekday, DEFAULT_SITE_READY_WEEKDAY);
  }

  // Migrate prior weekly month-list flag onto daily 4-day reminder.
  if (legacyWeeklyBillingDue !== undefined) {
    const d = o.daily && typeof o.daily === "object" && !Array.isArray(o.daily)
      ? (o.daily as Record<string, unknown>)
      : null;
    if (!d || typeof d.billing_due !== "boolean") {
      base.daily.billing_due = legacyWeeklyBillingDue;
    }
  }

  return base;
}

export function trackerCronUtcHint(
  kind: "daily" | "digest" | "site_ready",
  weekday?: number,
): string {
  if (kind === "daily") return "Sends every morning at ~8:00 AM Pacific (15:00 UTC).";
  const fallback = kind === "site_ready" ? DEFAULT_SITE_READY_WEEKDAY : DEFAULT_DIGEST_WEEKDAY;
  return `Sends ${weekdayLabel(normalizeWeekday(weekday, fallback))} mornings at ~8:00 AM Pacific (15:00 UTC).`;
}

/** Vercel cron runs at fixed UTC times; shown in settings for clarity. */
export const TRACKER_CRON_UTC_SCHEDULE = {
  daily: trackerCronUtcHint("daily"),
  weekly: trackerCronUtcHint("digest", DEFAULT_DIGEST_WEEKDAY),
  monday: trackerCronUtcHint("site_ready", DEFAULT_SITE_READY_WEEKDAY),
} as const;

const CRON_SLOTS: TrackerEmailCronSlot[] = ["daily", "weekly", "monday"];

function isCronSlot(value: string | undefined): value is TrackerEmailCronSlot {
  return Boolean(value && (CRON_SLOTS as string[]).includes(value));
}

/** Which digest/follow-up slots should run for this UTC calendar day. */
export function trackerCronSlotsDueOnUtcDate(
  now: Date,
  weekdays?: { digestWeekday?: number; siteReadyWeekday?: number },
): TrackerEmailCronSlot[] {
  const slots: TrackerEmailCronSlot[] = ["daily"];
  const dow = now.getUTCDay();
  const digest = normalizeWeekday(weekdays?.digestWeekday, DEFAULT_DIGEST_WEEKDAY);
  const siteReady = normalizeWeekday(weekdays?.siteReadyWeekday, DEFAULT_SITE_READY_WEEKDAY);
  if (dow === siteReady) slots.push("monday");
  if (dow === digest) slots.push("weekly");
  return slots;
}

/**
 * Map a Vercel `x-vercel-cron-schedule` expression to a slot.
 * Day-of-week 1 = Monday site-ready, 5 = Friday weekly digest, * = daily.
 */
export function trackerCronSlotFromExpression(expr: string | undefined): TrackerEmailCronSlot | null {
  if (!expr?.trim()) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const dow = parts[4];
  if (dow === "5") return "weekly";
  if (dow === "1") return "monday";
  return "daily";
}

function cronExpressionHasSpecificWeekday(expr: string | undefined): boolean {
  const parts = expr?.trim().split(/\s+/) ?? [];
  return parts.length >= 5 && parts[4] !== "*";
}

/**
 * Resolve which tracker cron slots to run.
 * Manual `?slot=` wins; otherwise a weekday-specific Vercel schedule header;
 * otherwise every slot due on this UTC date (single daily cron).
 */
export function resolveTrackerCronSlots(input: {
  querySlot?: string;
  cronScheduleHeader?: string;
  now?: Date;
  digestWeekday?: number;
  siteReadyWeekday?: number;
}): TrackerEmailCronSlot[] {
  const query = input.querySlot?.trim();
  if (isCronSlot(query)) return [query];

  if (cronExpressionHasSpecificWeekday(input.cronScheduleHeader)) {
    const fromHeader = trackerCronSlotFromExpression(input.cronScheduleHeader);
    if (fromHeader) return [fromHeader];
  }

  return trackerCronSlotsDueOnUtcDate(input.now ?? new Date(), {
    digestWeekday: input.digestWeekday,
    siteReadyWeekday: input.siteReadyWeekday,
  });
}
