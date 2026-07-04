import { supabase } from "./supabase";

const FIELD_VIEW_SESSION_KEY = "jobflow_field_view_session_v1";

export type FieldViewSession = {
  profileId: string;
  sessionToken: string;
  name: string;
  role: string;
  loggedInAt: string;
};

export function loadFieldViewSession(): FieldViewSession | null {
  try {
    const raw = localStorage.getItem(FIELD_VIEW_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FieldViewSession;
    if (!parsed?.profileId || !parsed.sessionToken?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFieldViewSession(session: FieldViewSession): void {
  localStorage.setItem(FIELD_VIEW_SESSION_KEY, JSON.stringify(session));
}

export function clearFieldViewSession(): void {
  localStorage.removeItem(FIELD_VIEW_SESSION_KEY);
}

export async function loginFieldViewWithPin(pin: string): Promise<FieldViewSession> {
  const { data, error } = await supabase.rpc("field_tools_login_pin" as never, { p_pin: pin } as never);
  if (error) throw new Error(error.message);

  const result = data as {
    ok?: boolean;
    error?: string;
    session_token?: string;
    profile?: { id?: string; name?: string; role?: string };
  };
  if (!result?.ok || !result.profile?.id) {
    throw new Error(result?.error ?? "Login failed");
  }

  const token = result.session_token?.trim();
  if (!token) throw new Error("Login succeeded but no session was issued.");

  const session: FieldViewSession = {
    profileId: result.profile.id,
    sessionToken: token,
    name: result.profile.name ?? "Field user",
    role: result.profile.role ?? "field",
    loggedInAt: new Date().toISOString(),
  };
  saveFieldViewSession(session);
  return session;
}

export async function logoutFieldView(session: FieldViewSession | null): Promise<void> {
  clearFieldViewSession();
  const token = session?.sessionToken?.trim();
  if (token) {
    await supabase.rpc("field_tools_revoke_session" as never, { p_session_token: token } as never);
  }
}

export function fieldViewRpcAuthArgs(session: FieldViewSession | null): {
  p_caller_id?: string;
  p_session_token?: string;
} {
  if (!session?.profileId || !session.sessionToken?.trim()) return {};
  return {
    p_caller_id: session.profileId,
    p_session_token: session.sessionToken,
  };
}

type CodeHandoff = {
  profileId: string;
  code: string;
};

function parseFieldViewHandoffHash(): CodeHandoff | null {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const profileId = params.get("p")?.trim();
  const code = params.get("hc")?.trim();
  if (!profileId || !code) return null;

  return { profileId, code };
}

/** Remove expired legacy handoff hashes (#p=…&t=…) from the address bar. */
export function clearLegacyFieldViewHandoffHash(): void {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return;

  const params = new URLSearchParams(raw);
  if (params.get("hc")?.trim()) return;
  if (params.get("p") || params.get("t")) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
  }
}

export function hasFieldViewHandoffHash(): boolean {
  return parseFieldViewHandoffHash() !== null;
}

function stripFieldViewHandoffHash(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}

async function validateFieldViewSessionAuth(session: FieldViewSession): Promise<boolean> {
  const { error } = await supabase.rpc(
    "field_view_company_name" as never,
    fieldViewRpcAuthArgs(session) as never,
  );
  return !error;
}

async function exchangeHandoffCode(profileId: string, code: string): Promise<FieldViewSession | null> {
  const { data, error } = await supabase.rpc("field_tools_exchange_handoff_code" as never, {
    p_caller_id: profileId,
    p_code: code,
  } as never);

  const result = data as {
    ok?: boolean;
    error?: string;
    session_token?: string;
    profile?: { id?: string; name?: string; role?: string };
  } | null;

  if (error || !result?.ok || !result.session_token?.trim() || !result.profile?.id) {
    return null;
  }

  return {
    profileId: result.profile.id,
    sessionToken: result.session_token.trim(),
    name: result.profile.name ?? "Field user",
    role: result.profile.role ?? "field",
    loggedInAt: new Date().toISOString(),
  };
}

export function clearFieldViewHandoffFromUrl(): void {
  if (!hasFieldViewHandoffHash()) return;
  stripFieldViewHandoffHash();
}

/** Accept a Field Tools handoff from the URL hash (#p=…&hc=…), then remove it from the address bar. */
export async function applyFieldViewHandoffFromHash(): Promise<FieldViewSession | null> {
  clearLegacyFieldViewHandoffHash();

  const handoff = parseFieldViewHandoffHash();
  if (!handoff) return null;

  stripFieldViewHandoffHash();

  const session = await exchangeHandoffCode(handoff.profileId, handoff.code);
  if (!session) return null;

  const valid = await validateFieldViewSessionAuth(session);
  if (!valid) return null;

  saveFieldViewSession(session);
  return session;
}
