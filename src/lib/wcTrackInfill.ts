import type { WallcoveringItem } from "../types/tradeDocuments";
import { emptyWallcoveringItem } from "../types/tradeDocuments";

export const WC_TRACK_MFR = "APS";
export const WC_TRACK_PRODUCT = "Track and Infill";

export function isTrackInfillItem(item: WallcoveringItem): boolean {
  return (
    item.product.trim() === WC_TRACK_PRODUCT &&
    item.manufacturer.trim().toUpperCase() === WC_TRACK_MFR
  );
}

export function trackInfillPreset(): WallcoveringItem {
  return {
    ...emptyWallcoveringItem(),
    manufacturer: WC_TRACK_MFR,
    product: WC_TRACK_PRODUCT,
  };
}

export function applyGotTrackToggle(
  items: WallcoveringItem[],
  gotTrack: boolean,
): WallcoveringItem[] {
  if (gotTrack) {
    if (items.some(isTrackInfillItem)) return items;
    return [...items, trackInfillPreset()];
  }
  const next = items.filter((i) => !isTrackInfillItem(i));
  return next.length ? next : [emptyWallcoveringItem()];
}

export function detectGotTrack(items: WallcoveringItem[]): boolean {
  return items.some(isTrackInfillItem);
}
