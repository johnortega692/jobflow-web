import { supabase } from "./supabase.js";

const FIELD_VIEW_SESSION_KEY = "jobflow_field_view_session_v1";
const FIELD_VIEW_REAUTH_EVENT = "jobflow:field-view-reauth";

export const FIELD_VIEW_SESSION_EXPIRED_MESSAGE =
  "Session expired — enter your PIN to continue.";

export type FieldViewSession = {
  profileId: string;
  sessionToken: string;
  name: string;
  role: string;
  loggedInAt: string;
};

export function isFieldViewSessionAuthError(message: string): boolean {
  const m = message.toUpperCase();
  return (
    m.includes("INVALID_SESSION") ||
    m.includes("FIELD_VIEW_LOGIN_REQUIRED") ||
    m.includes("SESSION_REQUIRED") ||
    (m.includes("FIELD_VIEW") && (m.includes("SESSION") || m.includes("LOGIN") || m.includes("AUTH")))
  );
}

/** Clear local session and tell Field View to show the PIN screen. */
export function forceFieldViewReauth(message = FIELD_VIEW_SESSION_EXPIRED_MESSAGE): void {
  clearFieldViewSession();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FIELD_VIEW_REAUTH_EVENT, { detail: { message } }));
}

/** If `message` is a dead-session error, kick to PIN and return true. */
export function noteFieldViewSessionFailure(message: string | null | undefined): boolean {
  if (!message || !isFieldViewSessionAuthError(message)) return false;
  forceFieldViewReauth();
  return true;
}

export function subscribeFieldViewReauth(handler: (message: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    handler(detail?.message?.trim() || FIELD_VIEW_SESSION_EXPIRED_MESSAGE);
  };
  window.addEventListener(FIELD_VIEW_REAUTH_EVENT, listener);
  return () => window.removeEventListener(FIELD_VIEW_REAUTH_EVENT, listener);
}

/**
 * Cheap server check for Field View PIN session.
 * On auth failure, clears session and emits reauth. Network blips do not log out.
 */
export async function validateFieldViewSession(
  session: FieldViewSession | null = loadFieldViewSession(),
): Promise<boolean> {
  if (!session?.profileId || !session.sessionToken?.trim()) {
    forceFieldViewReauth();
    return false;
  }
  const { error } = await supabase.rpc(
    "field_view_company_name" as never,
    fieldViewRpcAuthArgs(session) as never,
  );
  if (!error) return true;
  if (isFieldViewSessionAuthError(error.message)) {
    forceFieldViewReauth();
    return false;
  }
  return true;
}

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

const FIELD_VIEW_DEVICE_TOKEN_KEY = "jobflow_field_view_device_token";
const FIELD_VIEW_SHARED_IDLE_KEY = "jobflow_field_view_shared_idle_minutes";

export type FieldViewCodeChallenge = {
  kind: "code";
  challengeId: string;
  maskedEmail: string;
};

export type FieldViewAdminApproval = {
  kind: "admin";
  error: string;
};

export type FieldViewPinResult = FieldViewSession | FieldViewCodeChallenge | FieldViewAdminApproval;

type DeviceLoginBody = {
  ok?: boolean;
  error?: string;
  needs_code?: boolean;
  needs_admin?: boolean;
  challenge_id?: string;
  masked_email?: string;
  session_token?: string;
  device_token?: string;
  idle_timeout_minutes?: number;
  profile?: { id?: string; name?: string; role?: string; safety_pin?: boolean };
};

function readFieldViewDeviceToken(): string | null {
  try {
    return localStorage.getItem(FIELD_VIEW_DEVICE_TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function storeFieldViewDeviceToken(token: string | undefined): void {
  const value = token?.trim();
  if (!value) return;
  try {
    localStorage.setItem(FIELD_VIEW_DEVICE_TOKEN_KEY, value);
  } catch {
    /* private mode */
  }
}

let idleTimer = 0;
let idleLimitMs = 0;
let idleLast = 0;
let idleListening = false;

function clearFieldViewIdleWatch(): void {
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = 0;
  idleLimitMs = 0;
}

function signOutFieldViewForIdle(): void {
  const session = loadFieldViewSession();
  clearFieldViewIdleWatch();
  try {
    localStorage.removeItem(FIELD_VIEW_SHARED_IDLE_KEY);
  } catch {
    /* ignore */
  }
  void logoutFieldView(session);
  forceFieldViewReauth();
}

function scheduleFieldViewIdleCheck(): void {
  if (!idleLimitMs) return;
  if (idleTimer) window.clearTimeout(idleTimer);
  const wait = Math.max(1000, idleLimitMs - (Date.now() - idleLast));
  idleTimer = window.setTimeout(() => {
    if (Date.now() - idleLast >= idleLimitMs) signOutFieldViewForIdle();
    else scheduleFieldViewIdleCheck();
  }, wait);
}

function noteFieldViewIdleActivity(): void {
  if (!idleLimitMs) return;
  idleLast = Date.now();
  scheduleFieldViewIdleCheck();
}

function armFieldViewSharedIdle(minutes: number): void {
  idleLimitMs = minutes * 60 * 1000;
  idleLast = Date.now();
  if (!idleListening && typeof window !== "undefined") {
    idleListening = true;
    for (const event of ["pointerdown", "keydown", "touchstart", "scroll"] as const) {
      window.addEventListener(event, noteFieldViewIdleActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleFieldViewIdleCheck();
    });
  }
  scheduleFieldViewIdleCheck();
}

function rememberFieldViewSharedIdle(minutes: number | undefined, sessionToken: string): void {
  if (!minutes || minutes <= 0 || !sessionToken) {
    clearFieldViewIdleWatch();
    try {
      localStorage.removeItem(FIELD_VIEW_SHARED_IDLE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.setItem(FIELD_VIEW_SHARED_IDLE_KEY, String(minutes));
  } catch {
    /* ignore */
  }
  armFieldViewSharedIdle(minutes);
}

function resumeFieldViewSharedIdle(): void {
  if (typeof window === "undefined" || !loadFieldViewSession()) return;
  try {
    const minutes = Number(localStorage.getItem(FIELD_VIEW_SHARED_IDLE_KEY));
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    armFieldViewSharedIdle(minutes);
  } catch {
    /* ignore */
  }
}

function sessionFromDeviceLogin(result: DeviceLoginBody | null): FieldViewSession {
  if (!result?.ok || !result.profile?.id) {
    throw new Error(result?.error ?? "Login failed");
  }
  const token = result.session_token?.trim();
  if (!token) throw new Error("Login succeeded but no session was issued.");
  storeFieldViewDeviceToken(result.device_token);
  rememberFieldViewSharedIdle(result.idle_timeout_minutes, token);
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

export async function loginFieldViewWithPin(pin: string): Promise<FieldViewPinResult> {
  const { data, error } = await supabase.functions.invoke("field-tools-device-login", {
    body: { pin, device_token: readFieldViewDeviceToken() },
  });
  if (error) throw new Error("Sign in failed. Try again.");
  const result = data as DeviceLoginBody | null;
  if (result?.ok && result.profile?.safety_pin === true) {
    return sessionFromDeviceLogin(result);
  }
  if (result?.needs_admin) {
    storeFieldViewDeviceToken(result.device_token);
    return { kind: "admin", error: result.error?.trim() || "Ask your admin to approve this device" };
  }
  if (result?.needs_code && result.challenge_id) {
    return {
      kind: "code",
      challengeId: result.challenge_id,
      maskedEmail: result.masked_email?.trim() || "",
    };
  }
  return sessionFromDeviceLogin(result);
}

export async function verifyFieldViewDeviceCode(input: {
  challengeId: string;
  code: string;
  trust: boolean;
}): Promise<FieldViewSession> {
  const { data, error } = await supabase.functions.invoke("field-tools-device-verify", {
    body: {
      challenge_id: input.challengeId,
      code: input.code,
      trust: input.trust,
      device_token: readFieldViewDeviceToken(),
    },
  });
  if (error) throw new Error("That code is wrong or no longer valid.");
  return sessionFromDeviceLogin(data as DeviceLoginBody | null);
}

export async function logoutFieldView(session: FieldViewSession | null): Promise<void> {
  clearFieldViewIdleWatch();
  try {
    localStorage.removeItem(FIELD_VIEW_SHARED_IDLE_KEY);
  } catch {
    /* ignore */
  }
  clearFieldViewSession();
  const token = session?.sessionToken?.trim();
  if (token) {
    await supabase.rpc("field_tools_revoke_session" as never, { p_session_token: token } as never);
  }
}

if (typeof window !== "undefined") {
  resumeFieldViewSharedIdle();
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
