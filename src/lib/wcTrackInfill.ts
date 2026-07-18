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

export function trackInfillPreset(previous?: WallcoveringItem | null): WallcoveringItem {
  if (previous && isTrackInfillItem(previous)) {
    return {
      ...previous,
      label: "",
      include_in_submittal: false,
      unit: previous.unit?.trim() || "LF",
    };
  }
  return {
    ...emptyWallcoveringItem(),
    manufacturer: WC_TRACK_MFR,
    product: WC_TRACK_PRODUCT,
    unit: "LF",
    include_in_submittal: false,
  };
}

/** Keep track row pinned last when present. */
export function withTrackRowLast(items: WallcoveringItem[]): WallcoveringItem[] {
  const track = items.find(isTrackInfillItem);
  const rest = items.filter((i) => !isTrackInfillItem(i));
  return track ? [...rest, track] : rest;
}

export function applyGotTrackToggle(
  items: WallcoveringItem[],
  gotTrack: boolean,
  previousTrack?: WallcoveringItem | null,
): WallcoveringItem[] {
  if (gotTrack) {
    if (items.some(isTrackInfillItem)) return withTrackRowLast(items);
    return withTrackRowLast([...items, trackInfillPreset(previousTrack)]);
  }
  const next = items.filter((i) => !isTrackInfillItem(i));
  return next.length ? next : [emptyWallcoveringItem()];
}

export function detectGotTrack(items: WallcoveringItem[]): boolean {
  return items.some(isTrackInfillItem);
}
