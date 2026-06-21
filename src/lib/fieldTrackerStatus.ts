import type { PaintTrackerState, WcTrackerLineState } from "../types/fieldTracker";

export type PaintFieldStatus =
  | "Not Started"
  | "Match Existing"
  | "Submittal Ordered"
  | "Submitted for Approval"
  | "Needs Revision"
  | "Approved"
  | "No Paint";

export type WcFieldStatus =
  | "Not Started"
  | "Submittal Ordered"
  | "Submitted for Approval"
  | "Approved"
  | "Material Ordered"
  | "Delivered";

export function paintFieldStatus(tracker: PaintTrackerState): PaintFieldStatus {
  if (tracker.noPaint) return "No Paint";
  if (tracker.revision && !tracker.approved) return "Needs Revision";
  if (tracker.approved) return "Approved";
  if (tracker.submittedForApproval) return "Submitted for Approval";
  if (tracker.submittalOrdered) return "Submittal Ordered";
  if (tracker.matchExisting) return "Match Existing";
  return "Not Started";
}

export function wcFieldStatus(line: WcTrackerLineState): WcFieldStatus {
  if (line.delivered) return "Delivered";
  if (line.materialOrder) return "Material Ordered";
  if (line.approved) return "Approved";
  if (line.sentForApproval) return "Submitted for Approval";
  if (line.ordered) return "Submittal Ordered";
  return "Not Started";
}

export function paintStatusLabel(status: PaintFieldStatus): string {
  if (status === "Submitted for Approval") return "Sent for Approval";
  return status;
}

export function wcStatusLabel(status: WcFieldStatus): string {
  if (status === "Submitted for Approval") return "Sent for Approval";
  return status;
}

export function paintPillClass(status: PaintFieldStatus): string {
  switch (status) {
    case "No Paint":
      return "pill-no-paint";
    case "Needs Revision":
      return "pill-revision";
    case "Approved":
      return "pill-approved";
    case "Submitted for Approval":
      return "pill-submitted";
    case "Submittal Ordered":
      return "pill-ordered";
    case "Match Existing":
      return "pill-match";
    default:
      return "pill-not-started";
  }
}

export function wcPillClass(status: WcFieldStatus): string {
  switch (status) {
    case "Delivered":
      return "pill-delivered";
    case "Material Ordered":
      return "pill-material-ordered";
    case "Approved":
      return "pill-approved";
    case "Submitted for Approval":
      return "pill-submitted";
    case "Submittal Ordered":
      return "pill-submittal-ordered";
    default:
      return "pill-not-started";
  }
}

export function wcDotClass(status: WcFieldStatus): string {
  switch (status) {
    case "Delivered":
      return "dot-delivered";
    case "Material Ordered":
      return "dot-material-ordered";
    case "Approved":
      return "dot-approved";
    case "Submitted for Approval":
      return "dot-submitted";
    case "Submittal Ordered":
      return "dot-submittal-ordered";
    default:
      return "dot-not-started";
  }
}
