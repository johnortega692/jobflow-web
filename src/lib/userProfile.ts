import type { LetterheadSettings } from "../types/letterheadSettings";
import type { UserProfile } from "../types/userProfile";
import type { PrintBranding } from "./printCore";
import type { RfiFormData } from "../types/database";
import type { SdsPacketData, TransmittalData } from "../types/tradeDocuments";

export function profileFromSettings(settings: LetterheadSettings): UserProfile {
  return {
    name: settings.signer_name,
    title: settings.signer_title,
    phone: settings.signer_phone,
    email: settings.signer_email,
  };
}

export function profileToSettingsPatch(profile: Partial<UserProfile>): Partial<LetterheadSettings> {
  const patch: Partial<LetterheadSettings> = {};
  if (profile.name !== undefined) patch.signer_name = profile.name;
  if (profile.title !== undefined) patch.signer_title = profile.title;
  if (profile.phone !== undefined) patch.signer_phone = profile.phone;
  if (profile.email !== undefined) patch.signer_email = profile.email;
  return patch;
}

export function profileDisplayLabel(profile: UserProfile): string {
  const name = profile.name.trim();
  if (!name) return "";
  const title = profile.title.trim();
  return title ? `${name}, ${title}` : name;
}

export function applyRfiProfileDefaults(form: RfiFormData, profile: UserProfile): RfiFormData {
  if (form.from_name.trim() || !profile.name.trim()) return form;
  return { ...form, from_name: profile.name.trim() };
}

export function applyTransmittalProfileDefaults(
  data: TransmittalData,
  profile: UserProfile,
  branding: PrintBranding,
): TransmittalData {
  return {
    ...data,
    from_block: data.from_block.trim() || branding.fromBlock,
    from_phone: data.from_phone.trim() || profile.phone.trim() || branding.fromPhone,
    signer_name: data.signer_name.trim() || profile.name.trim() || branding.signerName,
  };
}

export function applySdsProfileDefaults(data: SdsPacketData, profile: UserProfile): SdsPacketData {
  if (data.preparer.trim() || !profile.name.trim()) return data;
  return { ...data, preparer: profile.name.trim() };
}
