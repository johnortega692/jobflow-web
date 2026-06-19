import type { WallcoveringItem } from "../types/tradeDocuments";
import { googleSheetsPost } from "./googleSheetsApi";

export type WcTrackerRow = {
  label: string;
  manufacturer: string;
  product: string;
  color: string;
  panels: boolean;
};

export async function copyWallcoveringToTracker(
  webAppUrl: string | undefined,
  jobNumber: string,
  jobName: string,
  gcName: string,
  startDate: string,
  items: WallcoveringItem[],
): Promise<string | null> {
  if (!webAppUrl?.trim()) {
    return "Wallcovering Tracker URL not configured in Settings.";
  }
  const rows: WcTrackerRow[] = items
    .filter((i) => i.manufacturer.trim() || i.product.trim() || i.label.trim())
    .map((i) => ({
      label: i.label,
      manufacturer: i.manufacturer,
      product: i.product,
      color: i.color,
      panels: i.panels,
    }));
  if (!rows.length) return "No wallcovering items with data to copy.";
  if (!jobNumber.trim() || !jobName.trim()) {
    return "Job number and job name are required.";
  }

  const { status } = await googleSheetsPost(
    webAppUrl,
    {
      jobNumber,
      jobName,
      gcName,
      startDate,
      items: rows,
    },
    { sheet: "wallcovering" },
  );
  if (status !== 200) return `Wallcovering Tracker update failed (${status}).`;
  return null;
}
