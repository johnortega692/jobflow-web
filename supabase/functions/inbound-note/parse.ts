export type InboundMail = {
  from: string;
  to: string[];
  cc?: string[];
  receivedFor?: string[];
  subject: string;
  text: string;
};

export type InboundNoteDraft = {
  jobKey: string;
  senderEmail: string;
  body: string;
  cor: boolean;
};

export type InboundNoteResult =
  | { ok: true; note: InboundNoteDraft }
  | { ok: false; reason: string };

const FORWARD_MARK = /^-{2,}\s*forwarded message\s*-{2,}\s*$/im;
const ORIGINAL_MARK = /^-{2,}\s*original message\s*-{2,}\s*$/im;

export function emailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export function displayName(value: string): string {
  const named = value.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named?.[1]?.trim()) return named[1].trim();
  const address = emailAddress(value);
  const local = address.split("@")[0] ?? "";
  return local.replace(/[._]+/g, " ").trim();
}

export function jobKeyFromMailbox(address: string, domain: string): string | null {
  const email = emailAddress(address);
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  if (email.slice(at + 1) !== domain.trim().toLowerCase()) return null;
  const key = email.slice(0, at).replace(/[^a-z0-9]+/g, "");
  return key || null;
}

function stripReplyPrefix(subject: string): string {
  let next = subject.trim();
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/^(fwd?|re)\s*:\s*/i, "").trim();
  }
  return next;
}

function normalizeSigLine(line: string): string {
  return line.trim().replace(/^[*_]+|[*_]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isDisclaimerLine(line: string): boolean {
  const trimmed = line.trim().replace(/^[*_]+/, "");
  return /^(this (e-?mail|message)|confidentiality (notice|warning)|disclaimer)\b/i.test(trimmed);
}

function isSignatureLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/\+?\d[\d\s().-]{7,}\d/.test(trimmed)) return true;
  if (/\b(mobile|office|cell|phone|tel|fax|license|uei)\b/i.test(trimmed)) return true;
  if (/https?:\/\/|www\./i.test(trimmed)) return true;
  if (/equal opportunity employer/i.test(trimmed)) return true;
  if (/\s\|\s/.test(trimmed)) return true;
  return false;
}

function isMarkedPersonLine(line: string): boolean {
  const match = line.trim().match(/^\*([^*]{2,60})\*$/);
  if (!match) return false;
  const words = match[1].trim().split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word));
}

function hasSignatureAfter(lines: string[], index: number): boolean {
  return lines.slice(index + 1, index + 8).some(isSignatureLine);
}

export function stripSignature(text: string, senderName = ""): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const name = normalizeSigLine(senderName);
  const cut = lines.findIndex((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (index > 0 && (trimmed === "--" || /^sent from my /i.test(trimmed) || /^get outlook for /i.test(trimmed))) {
      return true;
    }
    if (isDisclaimerLine(trimmed)) return true;
    const matchesSender = Boolean(name) && normalizeSigLine(trimmed) === name;
    if ((matchesSender || isMarkedPersonLine(trimmed)) && hasSignatureAfter(lines, index)) return true;
    return false;
  });
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function headerValue(block: string, name: string): string {
  const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

/** Pull the original subject, sender, and message out of a forward. */
export function unwrapForward(subject: string, text: string, senderName = ""): { subject: string; from: string; message: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const mark = FORWARD_MARK.exec(normalized) ?? ORIGINAL_MARK.exec(normalized);
  if (!mark) {
    return { subject: stripReplyPrefix(subject), from: "", message: stripSignature(normalized, senderName) };
  }
  const after = normalized.slice(mark.index + mark[0].length).replace(/^\n+/, "");
  const splitAt = after.search(/\n\s*\n/);
  const header = splitAt === -1 ? after : after.slice(0, splitAt);
  const message = splitAt === -1 ? "" : after.slice(splitAt + 1);
  const innerSubject = headerValue(header, "subject");
  const innerFrom = headerValue(header, "from");
  return {
    subject: stripReplyPrefix(innerSubject || subject),
    from: innerFrom,
    message: stripSignature(message.trim(), displayName(innerFrom) || senderName),
  };
}

export function looksLikeChangeOrder(subject: string, message: string): boolean {
  const haystack = `${subject}\n${message}`;
  return /\bcor\b/i.test(haystack) || /change\s+order/i.test(haystack);
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function buildInboundNote(
  mail: InboundMail,
  options: { domain: string; allowedEmails: string[] },
): InboundNoteResult {
  const domain = options.domain.trim().toLowerCase();
  const allowed = new Set(options.allowedEmails.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const senderEmail = emailAddress(mail.from);
  if (!senderEmail || !senderEmail.includes("@")) return { ok: false, reason: "missing-sender" };
  if (!allowed.has(senderEmail)) return { ok: false, reason: "sender-not-allowed" };

  const recipients = [...mail.to, ...(mail.cc ?? []), ...(mail.receivedFor ?? [])];
  const jobKey = recipients.map((address) => jobKeyFromMailbox(address, domain)).find((key) => key) ?? null;
  if (!jobKey) return { ok: false, reason: "no-job-address" };

  const fromLine = displayName(mail.from);
  const unwrapped = unwrapForward(mail.subject, mail.text, fromLine);
  const subject = clip(unwrapped.subject || "Email", 180);
  const shownFrom = displayName(unwrapped.from || mail.from);
  const message = clip(unwrapped.message, 4000);
  const lines = [subject];
  if (shownFrom) lines.push(`From ${shownFrom}`);
  if (message) lines.push(message);

  return {
    ok: true,
    note: {
      jobKey,
      senderEmail,
      body: lines.join("\n"),
      cor: looksLikeChangeOrder(subject, message),
    },
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function secretBytes(secret: string): Uint8Array {
  const raw = secret.trim().replace(/^whsec_/, "");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function signResendWebhook(id: string, timestamp: string, body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${bytesToBase64(signed)}`;
}

export async function verifyResendWebhook(
  body: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const age = Math.abs(now - timestamp * 1000);
  if (age > 5 * 60 * 1000) return false;
  let expected: string;
  try {
    expected = await signResendWebhook(headers.id, headers.timestamp, body, secret);
  } catch {
    return false;
  }
  const expectedSig = expected.slice(3);
  return headers.signature.split(" ").some((part) => {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    if (sig.length !== expectedSig.length) return false;
    let mismatch = 0;
    for (let index = 0; index < sig.length; index += 1) mismatch |= sig.charCodeAt(index) ^ expectedSig.charCodeAt(index);
    return mismatch === 0;
  });
}
