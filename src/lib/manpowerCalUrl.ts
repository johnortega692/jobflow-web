import { loadFieldViewSession, type FieldViewSession } from "./fieldViewAuth";

const MANPOWER_CAL_URL =
  import.meta.env.VITE_MANPOWER_CAL_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5174" : "https://manpower-cal.vercel.app");

export function manpowerCalUrl(): string {
  return MANPOWER_CAL_URL;
}

/**
 * Manpower Cal URL with a one-tap handoff for Field Tools crew: passes the
 * active Field Tools session in the URL hash (never sent to the server) so
 * Manpower can exchange it for its own token without a second PIN entry.
 * Office users (no Field Tools session) get the plain URL.
 */
export function manpowerCalHandoffUrl(session: FieldViewSession | null = loadFieldViewSession()): string {
  const base = MANPOWER_CAL_URL.replace(/#.*$/, "").replace(/\?.*$/, "");
  if (!session?.profileId || !session.sessionToken?.trim()) {
    return base;
  }

  const params = new URLSearchParams();
  params.set("fp", session.profileId);
  params.set("ft", session.sessionToken.trim());
  return `${base}#${params.toString()}`;
}
