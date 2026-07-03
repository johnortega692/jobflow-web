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
