/** One receiving domain. Each job is a mailbox on it, not its own subdomain. */
export const NOTE_INBOX_DOMAIN = "notes.ortegabuilt.com";

/** Letters and digits only, so the address matches the job number with spaces and dashes removed. */
export function noteInboxKey(jobNumber: string): string {
  return jobNumber.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function noteInboxAddress(jobNumber: string, domain = NOTE_INBOX_DOMAIN): string | null {
  const key = noteInboxKey(jobNumber);
  if (!key) return null;
  return `${key}@${domain}`;
}
