import { sendJobFlowNotification } from "../sendJobFlowEmail.ts";

type SupabaseLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function alertLink(token: string): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const url = new URL(`${base}/functions/v1/field-tools-device-alert-action`);
  url.searchParams.set("token", token);
  if (key) url.searchParams.set("apikey", key);
  return url.toString();
}

async function claim(supabase: SupabaseLike, recipient: string, eventKey: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("field_tools_claim_device_email", {
    p_recipient: recipient,
    p_event_key: eventKey,
  });
  if (error) return false;
  return data === true;
}

export async function sendDeviceNotice(
  supabase: SupabaseLike,
  input: {
    recipients: string[];
    eventKey: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<void> {
  const seen = new Set<string>();
  for (const raw of input.recipients) {
    const to = raw.trim().toLowerCase();
    if (!to || seen.has(to)) continue;
    seen.add(to);
    const allowed = await claim(supabase, to, input.eventKey);
    if (!allowed) continue;
    try {
      await sendJobFlowNotification({
        to,
        subject: input.subject,
        text: input.text,
        htmlBody: input.html,
        jobFlowOnly: true,
      });
    } catch {
      // Claim already recorded, so a retry inside 10 minutes stays suppressed.
    }
  }
}

export function deviceMail(input: {
  subject: string;
  intro: string;
  name: string;
  label?: string;
  when?: string;
  lockUrl?: string;
}): { subject: string; text: string; html: string } {
  const lines = [input.intro];
  if (input.label) lines.push(`Device: ${input.label}`);
  if (input.when) lines.push(`Time: ${input.when}`);
  if (input.lockUrl) lines.push(`Not me, lock my account: ${input.lockUrl}`);
  const htmlParts = [`<p>${escapeHtml(input.intro)}</p>`];
  if (input.label) htmlParts.push(`<p>Device: ${escapeHtml(input.label)}</p>`);
  if (input.when) htmlParts.push(`<p>Time: ${escapeHtml(input.when)}</p>`);
  if (input.lockUrl) {
    htmlParts.push(`<p><a href="${escapeHtml(input.lockUrl)}">Not me, lock my account</a></p>`);
  }
  return { subject: input.subject, text: lines.join("\n"), html: htmlParts.join("") };
}

export function adminEmails(facts: { admin_emails?: unknown }): string[] {
  const value = facts.admin_emails;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.includes("@"));
}

export function stamp(): string {
  return new Date().toUTCString();
}
