import { supabase } from "./supabase";
import { loadFieldViewSession, type FieldViewSession } from "./fieldViewAuth";

const MANPOWER_CAL_URL =
  import.meta.env.VITE_MANPOWER_CAL_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5174" : "https://manpower-cal.vercel.app");

export function manpowerCalUrl(): string {
  return MANPOWER_CAL_URL;
}

async function createManpowerHandoffHash(session: FieldViewSession): Promise<string | null> {
  const { data, error } = await supabase.rpc("field_tools_create_handoff_code" as never, {
    p_caller_id: session.profileId,
    p_session_token: session.sessionToken.trim(),
    p_purpose: "manpower",
  } as never);

  const result = data as { ok?: boolean; code?: string } | null;
  if (error || !result?.ok || !result.code) return null;

  const params = new URLSearchParams();
  params.set("fp", session.profileId);
  params.set("hc", result.code);
  return params.toString();
}

/** Open Manpower Cal with a one-time handoff code (no session token in the URL). */
export async function openManpowerCalHandoff(
  session: FieldViewSession | null = loadFieldViewSession(),
  onError?: (message: string) => void,
): Promise<void> {
  const base = MANPOWER_CAL_URL.replace(/#.*$/, "").replace(/\?.*$/, "");
  const active = session ?? loadFieldViewSession();
  if (!active?.profileId || !active.sessionToken?.trim()) {
    onError?.("Sign in to Field View first, then open Manpower.");
    window.open(base, "_blank", "noopener,noreferrer");
    return;
  }

  const hash = await createManpowerHandoffHash(active);
  if (!hash) {
    onError?.("Could not transfer your sign-in to Manpower. Enter your PIN or try again.");
    window.open(base, "_blank", "noopener,noreferrer");
    return;
  }

  window.open(`${base}#${hash}`, "_blank", "noopener,noreferrer");
}

/** @deprecated Use openManpowerCalHandoff — kept so older imports still compile. */
export function manpowerCalHandoffUrl(_session: FieldViewSession | null = loadFieldViewSession()): string {
  return manpowerCalUrl();
}
