/** Sync Submittal Ordered flag to Google Sheets Paint Tracker (column I). */

import { updatePaintTrackerFlags } from "./googleSheetsSync";

export async function syncSubmittalOrderedToSheets(
  baseUrl: string | undefined,
  jobNumber: string,
  submittalOrdered: boolean,
  nightsWeekends = false,
): Promise<string | null> {
  return updatePaintTrackerFlags(baseUrl, jobNumber, { submittalOrdered, nightsWeekends });
}
