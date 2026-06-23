import type { UserProfile } from "../types/userProfile";
import type { EmailSignatureSettings } from "./emailSignature";
import type { PaintUserSettings } from "./paintUserSettings";

export function resolvePaintNotificationFromProfile(
  profile: UserProfile,
  saved?: Partial<{ notification_primary_email: string; notification_primary_name: string }>,
): { notification_primary_email: string; notification_primary_name: string } {
  return {
    notification_primary_email: saved?.notification_primary_email?.trim() || profile.email.trim(),
    notification_primary_name: saved?.notification_primary_name?.trim() || profile.name.trim(),
  };
}

/** Signature line 1 = name, line 2 = title, line 3 = phone (when those lines are empty). */
export function mergeProfileIntoEmailSignature(
  signature: EmailSignatureSettings,
  profile: UserProfile,
): EmailSignatureSettings {
  const lines = [...signature.lines];
  if (!lines[0]?.trim() && profile.name.trim()) lines[0] = profile.name.trim();
  if (!lines[1]?.trim() && profile.title.trim()) lines[1] = profile.title.trim();
  if (!lines[2]?.trim() && profile.phone.trim()) lines[2] = profile.phone.trim();
  return { ...signature, lines };
}

export function applyProfilePaintDefaults(
  paint: PaintUserSettings,
  profile: UserProfile,
): PaintUserSettings {
  const notifications = resolvePaintNotificationFromProfile(profile, paint);
  return {
    ...paint,
    ...notifications,
    signature: mergeProfileIntoEmailSignature(paint.signature, profile),
  };
}
