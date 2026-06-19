export const TRANSMITTAL_PREFIX = "TR-";

/** Format sequence as TR-001, TR-002, … */
export function formatTransmittalNumber(seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  return `${TRANSMITTAL_PREFIX}${String(n).padStart(3, "0")}`;
}

/** Parse TR-001, tr-12, or plain 3 → numeric sequence. */
export function parseTransmittalNumber(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  const s = String(value ?? "").trim();
  if (!s) return 1;
  const m = s.match(/(\d+)\s*$/);
  if (m) return Math.max(1, parseInt(m[1]!, 10));
  return 1;
}

export function normalizeTransmittalNumber(value: string | number | null | undefined): string {
  return formatTransmittalNumber(parseTransmittalNumber(value));
}

export function nextTransmittalNumber(value: string | number | null | undefined): string {
  return formatTransmittalNumber(parseTransmittalNumber(value) + 1);
}
