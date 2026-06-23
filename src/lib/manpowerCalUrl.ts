const MANPOWER_CAL_URL =
  import.meta.env.VITE_MANPOWER_CAL_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5174" : "https://manpower-cal.vercel.app");

export function manpowerCalUrl(): string {
  return MANPOWER_CAL_URL;
}
