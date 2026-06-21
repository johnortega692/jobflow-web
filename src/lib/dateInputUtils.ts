const MONTH_NAMES =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)$/i;

/** Parse common free-text dates into a local calendar date. */
export function parseFlexibleDate(text: string): Date | null {
  const raw = text.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return localDate(+iso[1]!, +iso[2]! - 1, +iso[3]!);

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let y = +slash[3]!;
    if (y < 100) y += 2000;
    return localDate(y, +slash[1]! - 1, +slash[2]!);
  }

  const named = raw.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  if (named) {
    const month = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(named[1]!.toLowerCase());
    if (month >= 0) return localDate(+named[3]!, month, +named[2]!);
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function localDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

export function formatDateDisplay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function toIsoDateValue(text: string): string {
  const d = parseFlexibleDate(text);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function isoDateToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = localDate(+m[1]!, +m[2]! - 1, +m[3]!);
  return d ? formatDateDisplay(d) : iso;
}

export function isLikelyDateField(value: string): boolean {
  if (!value.trim()) return true;
  return Boolean(parseFlexibleDate(value)) || MONTH_NAMES.test(value.split(/\s+/)[0] ?? "");
}
