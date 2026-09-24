export type TrackerEmailCronStatusSource = "automatic" | "send_now";

export type TrackerEmailCronStatus = {
  at: string;
  source: TrackerEmailCronStatusSource;
  ok: boolean;
  slots: string[];
  sent: string[];
  skipped: string[];
  errors: { userId?: string; message: string }[];
  message: string;
};

export function normalizeTrackerEmailCronStatus(raw: unknown): TrackerEmailCronStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "string" || !o.at.trim()) return null;
  const source: TrackerEmailCronStatusSource = o.source === "send_now" ? "send_now" : "automatic";
  const errors = Array.isArray(o.errors)
    ? o.errors
        .map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return null;
          const rec = row as Record<string, unknown>;
          if (typeof rec.message !== "string" || !rec.message.trim()) return null;
          return {
            message: rec.message.trim(),
            ...(typeof rec.userId === "string" && rec.userId.trim() ? { userId: rec.userId.trim() } : {}),
          };
        })
        .filter((row): row is { message: string; userId?: string } => Boolean(row))
    : [];
  const sent = Array.isArray(o.sent)
    ? o.sent.filter((row): row is string => typeof row === "string" && row.trim().length > 0)
    : [];
  const skipped = Array.isArray(o.skipped)
    ? o.skipped.filter((row): row is string => typeof row === "string" && row.trim().length > 0)
    : [];
  const slots = Array.isArray(o.slots)
    ? o.slots.filter((row): row is string => typeof row === "string" && row.trim().length > 0)
    : [];
  const ok = typeof o.ok === "boolean" ? o.ok : errors.length === 0;
  const message =
    typeof o.message === "string" && o.message.trim()
      ? o.message.trim()
      : summarizeTrackerEmailCronStatus({ ok, sent, skipped, errors });
  return { at: o.at, source, ok, slots, sent, skipped, errors, message };
}

export function summarizeTrackerEmailCronStatus(input: {
  ok: boolean;
  sent: string[];
  skipped: string[];
  errors: { message: string }[];
}): string {
  if (input.errors.length) {
    return input.errors.map((row) => row.message).join(" · ");
  }
  if (input.sent.length) return input.sent.join(" · ");
  if (input.skipped.length) return `Nothing to send — ${input.skipped.join(" · ")}`;
  return "Ran with no jobs processed.";
}

export function trackerEmailCronStatusTone(
  status: TrackerEmailCronStatus,
): "banner-ok" | "banner-error" | "banner-warn" {
  if (status.errors.length || !status.ok) return "banner-error";
  if (status.sent.length) return "banner-ok";
  return "banner-warn";
}

export function trackerEmailCronStatusLabel(status: TrackerEmailCronStatus): string {
  if (status.errors.length || !status.ok) return "Error";
  if (status.sent.length) return "Sent";
  return "Ran — nothing to send";
}

export function formatTrackerEmailCronStatusTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const tz = timezone.trim() || "America/Los_Angeles";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function buildTrackerEmailCronStatus(input: {
  source: TrackerEmailCronStatusSource;
  slots?: string[];
  sent?: string[];
  skipped?: string[];
  errors?: { userId?: string; message: string }[];
  message?: string;
  ok?: boolean;
}): TrackerEmailCronStatus {
  const sent = input.sent ?? [];
  const skipped = input.skipped ?? [];
  const errors = input.errors ?? [];
  const ok = input.ok ?? errors.length === 0;
  return {
    at: new Date().toISOString(),
    source: input.source,
    ok,
    slots: input.slots ?? [],
    sent,
    skipped,
    errors,
    message: input.message?.trim() || summarizeTrackerEmailCronStatus({ ok, sent, skipped, errors }),
  };
}
