type PacketHistoryEntry = {
  submittal_number: number;
  revision_number?: number;
  scope?: string;
  packet_tracking?: string;
};

type PacketDraft = {
  submittal_number: number;
  revision_number: number;
  packet_tracking?: string;
};

function revisionNumber(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? Math.trunc(value ?? 0) : 0;
}

function samePaintPackage(entry: PacketHistoryEntry, draft: PacketDraft): boolean {
  return (
    (entry.scope ?? "paint") === "paint" &&
    entry.submittal_number === draft.submittal_number &&
    revisionNumber(entry.revision_number) === revisionNumber(draft.revision_number)
  );
}

/** Keep the mailed number on the history row for this paint submittal and revision. */
export function stampPaintPacketTracking<T extends PacketHistoryEntry>(history: T[], draft: PacketDraft): T[] {
  const packet_tracking = draft.packet_tracking?.trim() || undefined;
  return history.map((entry) => (samePaintPackage(entry, draft) ? { ...entry, packet_tracking } : entry));
}

/**
 * Number for the paint tracker. The open package wins. A new revision with no
 * number yet still shows the last mailed packet.
 */
export function paintPacketTrackingNumber(
  submittal: { packet_tracking?: string } | null | undefined,
  history: PacketHistoryEntry[] | null | undefined,
): string {
  const current = submittal?.packet_tracking?.trim() ?? "";
  if (current) return current;
  const mailed = (history ?? [])
    .filter((entry) => (entry.scope ?? "paint") === "paint" && entry.packet_tracking?.trim())
    .sort((a, b) => {
      const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
      if (numDiff !== 0) return numDiff;
      return revisionNumber(b.revision_number) - revisionNumber(a.revision_number);
    });
  return mailed[0]?.packet_tracking?.trim() ?? "";
}
