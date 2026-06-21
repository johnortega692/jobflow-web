export const RFI_STATUS_OPEN = "Open";
export const RFI_STATUS_CLOSED = "Closed";

export type RfiWorkflowStatus = typeof RFI_STATUS_OPEN | typeof RFI_STATUS_CLOSED;

export function normalizeRfiStatus(raw: string | null | undefined): RfiWorkflowStatus {
  if ((raw ?? "").trim().toLowerCase() === "closed") return RFI_STATUS_CLOSED;
  return RFI_STATUS_OPEN;
}

export function isRfiClosed(raw: string | null | undefined): boolean {
  return normalizeRfiStatus(raw) === RFI_STATUS_CLOSED;
}

export function rfiStatusCounts(rfis: { status?: string | null }[]): { total: number; open: number; closed: number } {
  const total = rfis.length;
  const closed = rfis.filter((r) => isRfiClosed(r.status)).length;
  return { total, open: total - closed, closed };
}
