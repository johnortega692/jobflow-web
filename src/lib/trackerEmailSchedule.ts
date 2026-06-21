export type TrackerEmailCronSlot = "daily" | "weekly";

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
  };
  weekly: {
    enabled: boolean;
    /** Combined paint + wallcovering submittal digest (Friday-style). */
    combined_digest: boolean;
    wallcovering_digest: boolean;
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
  },
  weekly: {
    enabled: false,
    combined_digest: true,
    wallcovering_digest: false,
  },
};

export function normalizeTrackerEmailSchedule(raw: unknown): TrackerEmailSchedule {
  const base = { ...DEFAULT_TRACKER_EMAIL_SCHEDULE };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  if (typeof o.enabled === "boolean") base.enabled = o.enabled;
  if (typeof o.timezone === "string" && o.timezone.trim()) base.timezone = o.timezone.trim();

  if (o.daily && typeof o.daily === "object" && !Array.isArray(o.daily)) {
    const d = o.daily as Record<string, unknown>;
    if (typeof d.enabled === "boolean") base.daily.enabled = d.enabled;
    if (typeof d.paint_followup === "boolean") base.daily.paint_followup = d.paint_followup;
    if (typeof d.wallcovering_followup === "boolean") {
      base.daily.wallcovering_followup = d.wallcovering_followup;
    }
    if (typeof d.installs === "boolean") base.daily.installs = d.installs;
  }

  if (o.weekly && typeof o.weekly === "object" && !Array.isArray(o.weekly)) {
    const w = o.weekly as Record<string, unknown>;
    if (typeof w.enabled === "boolean") base.weekly.enabled = w.enabled;
    if (typeof w.combined_digest === "boolean") base.weekly.combined_digest = w.combined_digest;
    if (typeof w.wallcovering_digest === "boolean") {
      base.weekly.wallcovering_digest = w.wallcovering_digest;
    }
  }

  return base;
}

/** Vercel cron runs at fixed UTC times; shown in settings for clarity. */
export const TRACKER_CRON_UTC_SCHEDULE = {
  daily: "15:00 UTC daily (~7:00 AM Pacific standard time)",
  weekly: "15:00 UTC Fridays (~7:00 AM Pacific standard time)",
} as const;
