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
/** Local hour (0–23) in `timezone`. Default 8:00 AM Pacific. */
export const DEFAULT_SEND_HOUR = 8;

export type TrackerEmailSchedule = {
  /** Master switch for Vercel cron sends for this account. */
  enabled: boolean;
  /** Used for follow-up "due today" date bucketing when cron runs. */
  timezone: string;
  /** Local hour (0–23) in `timezone` to send automatic emails. */
  send_hour: number;
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
    /** Weekday (0–6, local timezone) to send combined digest. */
    digest_weekday: number;
    /** Weekday (0–6, local timezone) to send wallcovering-only digest. */
    wallcovering_digest_weekday: number;
    /** Weekday (0–6, local timezone) to send site-ready + Needs attention. */
    site_ready_weekday: number;
  };
};

export const DEFAULT_TRACKER_EMAIL_SCHEDULE: TrackerEmailSchedule = {
  enabled: false,
  timezone: "America/Los_Angeles",
  send_hour: DEFAULT_SEND_HOUR,
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
    wallcovering_digest_weekday: DEFAULT_DIGEST_WEEKDAY,
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

export function normalizeHour(raw: unknown, fallback = DEFAULT_SEND_HOUR): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

export function formatSendHourLabel(hour: number): string {
  const h = normalizeHour(hour);
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Weekday (Sun=0) and hour (0–23) in the schedule timezone. */
export function zonedWeekdayAndHour(now: Date, timeZone: string): { weekday: number; hour: number } {
  const tz = timeZone.trim() || DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const wd = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    const hourRaw = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    return {
      weekday: WEEKDAY_SHORT[wd] ?? 0,
      hour: hourRaw === 24 ? 0 : hourRaw,
    };
  } catch {
    return { weekday: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

/** Calendar date (noon local) for `now` in the schedule timezone — used for “due today”. */
export function zonedCalendarDate(now: Date, timeZone?: string): Date {
  const tz = timeZone?.trim() || DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    if (!year || !month || !day) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    return new Date(year, month - 1, day, 12, 0, 0);
  } catch {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }
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
  base.send_hour = normalizeHour(o.send_hour, DEFAULT_SEND_HOUR);

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
    base.weekly.wallcovering_digest_weekday = normalizeWeekday(
      w.wallcovering_digest_weekday,
      base.weekly.digest_weekday,
    );
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
  sendHour = DEFAULT_SEND_HOUR,
  timezone = DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone,
): string {
  const when = `${formatSendHourLabel(sendHour)} ${timezone.replace(/_/g, " ")}`;
  if (kind === "daily") return `Sends every day at ${when}.`;
  const fallback = kind === "site_ready" ? DEFAULT_SITE_READY_WEEKDAY : DEFAULT_DIGEST_WEEKDAY;
  return `Sends ${weekdayLabel(normalizeWeekday(weekday, fallback))} at ${when}.`;
}

/** Default copy when settings have not loaded a custom send hour yet. */
export const TRACKER_CRON_UTC_SCHEDULE = {
  daily: trackerCronUtcHint("daily"),
  weekly: trackerCronUtcHint("digest", DEFAULT_DIGEST_WEEKDAY),
  monday: trackerCronUtcHint("site_ready", DEFAULT_SITE_READY_WEEKDAY),
} as const;

const CRON_SLOTS: TrackerEmailCronSlot[] = ["daily", "weekly", "monday"];

function isCronSlot(value: string | undefined): value is TrackerEmailCronSlot {
  return Boolean(value && (CRON_SLOTS as string[]).includes(value));
}

/** Which digest/follow-up slots should run for this local calendar day. Empty when not send hour. */
export function trackerCronSlotsDueOnUtcDate(
  now: Date,
  weekdays?: {
    digestWeekday?: number;
    wallcoveringDigestWeekday?: number;
    siteReadyWeekday?: number;
    timezone?: string;
    sendHour?: number;
  },
): TrackerEmailCronSlot[] {
  const timezone = weekdays?.timezone?.trim() || DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone;
  const sendHour = normalizeHour(weekdays?.sendHour, DEFAULT_SEND_HOUR);
  const { weekday, hour } = zonedWeekdayAndHour(now, timezone);
  if (hour !== sendHour) return [];
  const slots: TrackerEmailCronSlot[] = ["daily"];
  const digest = normalizeWeekday(weekdays?.digestWeekday, DEFAULT_DIGEST_WEEKDAY);
  const wcDigest = normalizeWeekday(weekdays?.wallcoveringDigestWeekday, digest);
  const siteReady = normalizeWeekday(weekdays?.siteReadyWeekday, DEFAULT_SITE_READY_WEEKDAY);
  if (weekday === siteReady) slots.push("monday");
  if (weekday === digest || weekday === wcDigest) slots.push("weekly");
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
  wallcoveringDigestWeekday?: number;
  siteReadyWeekday?: number;
  timezone?: string;
  sendHour?: number;
}): TrackerEmailCronSlot[] {
  const query = input.querySlot?.trim();
  if (isCronSlot(query)) return [query];

  if (cronExpressionHasSpecificWeekday(input.cronScheduleHeader)) {
    const fromHeader = trackerCronSlotFromExpression(input.cronScheduleHeader);
    if (fromHeader) return [fromHeader];
  }

  return trackerCronSlotsDueOnUtcDate(input.now ?? new Date(), {
    digestWeekday: input.digestWeekday,
    wallcoveringDigestWeekday: input.wallcoveringDigestWeekday,
    siteReadyWeekday: input.siteReadyWeekday,
    timezone: input.timezone,
    sendHour: input.sendHour,
  });
}
