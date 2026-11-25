export type ExteriorWindowProject = {
  is_exterior?: boolean | null;
  exterior_start?: string | null;
  exterior_end?: string | null;
};

function calendarKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const text = value.trim();
  if (!text) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1] ?? null;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!slash) return null;
  return `${slash[3]}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
}

export function normalizeExteriorDate(value: string | null | undefined): string | null {
  return calendarKey(value);
}

/** True when exterior rain watch should count this calendar day. */
export function isRainRelevant(project: ExteriorWindowProject, date: Date | string): boolean {
  if (project.is_exterior !== true) return false;
  const day = calendarKey(date);
  if (!day) return false;
  const start = calendarKey(project.exterior_start);
  const end = calendarKey(project.exterior_end);
  if (!start && !end) return true;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

export function exteriorWindowOrderError(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const startDay = calendarKey(start);
  const endDay = calendarKey(end);
  if (!startDay || !endDay) return null;
  if (endDay < startDay) return "Ends can't be before Starts.";
  return null;
}
