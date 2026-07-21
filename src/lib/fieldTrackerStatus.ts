import type { PaintTrackerState, WcTrackerLineState } from "../types/fieldTracker";
import { formatDateDisplay } from "./dateInputUtils";

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
  | "Needs Revision"
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

/**
 * Per-line required lifecycle. Field measurement and shops are optional
 * requirements tracked separately and do not advance the lifecycle status.
 */
export function wcFieldStatus(line: WcTrackerLineState): WcFieldStatus {
  if (line.delivered) return "Delivered";
  if (line.materialOrder) return "Material Ordered";
  if (line.revision && !line.approved) return "Needs Revision";
  if (line.approved) return "Approved";
  if (line.sentForApproval) return "Submitted for Approval";
  if (line.ordered) return "Submittal Ordered";
  return "Not Started";
}

/**
 * Overall wallcovering status is the bottleneck across all materials.
 * A revision is surfaced first because it needs action; otherwise the
 * least-advanced material determines the job-level summary.
 */
export function wcOverallStatus(lines: WcTrackerLineState[]): WcFieldStatus {
  if (!lines.length) return "Not Started";
  const statuses = lines.map(wcFieldStatus);
  if (statuses.includes("Needs Revision")) return "Needs Revision";

  const rank: Record<WcFieldStatus, number> = {
    "Not Started": 0,
    "Submittal Ordered": 1,
    "Submitted for Approval": 2,
    "Needs Revision": 2,
    "Approved": 3,
    "Material Ordered": 4,
    "Delivered": 5,
  };

  return statuses.reduce((least, status) => (rank[status] < rank[least] ? status : least));
}

export function paintStatusLabel(status: PaintFieldStatus): string {
  if (status === "Submitted for Approval") return "Sent for Approval";
  return status;
}

export function wcStatusLabel(status: WcFieldStatus): string {
  if (status === "Submitted for Approval") return "Sent for Approval";
  return status;
}

/** Line stages selectable per wallcovering material. */
export const WC_LINE_STAGES: WcFieldStatus[] = [
  "Not Started",
  "Submittal Ordered",
  "Submitted for Approval",
  "Needs Revision",
  "Approved",
  "Material Ordered",
  "Delivered",
];

/**
 * Set a line to a pipeline stage: check every flag up to and including the
 * stage, clear the later ones — same cumulative model as the desktop checkboxes.
 */
export function applyWcLineStage(line: WcTrackerLineState, stage: WcFieldStatus): WcTrackerLineState {
  if (stage === "Needs Revision") {
    return {
      ...line,
      ordered: true,
      sentForApproval: true,
      revision: true,
      approved: false,
      fieldMeasurement: false,
      shops: false,
      materialOrder: false,
      delivered: false,
    };
  }

  const order: Exclude<WcFieldStatus, "Not Started" | "Needs Revision">[] = [
    "Submittal Ordered",
    "Submitted for Approval",
    "Approved",
    "Material Ordered",
    "Delivered",
  ];
  const reached = order.indexOf(stage as (typeof order)[number]);
  const today = formatDateDisplay(new Date());
  return {
    ...line,
    ordered: reached >= 0,
    sentForApproval: reached >= 1,
    revision: false,
    approved: reached >= 2,
    materialOrder: reached >= 3,
    delivered: reached >= 4,
    approvalReceived: reached >= 2 && !line.approvalReceived.trim() ? today : line.approvalReceived,
    dateOrdered: reached >= 3 && !line.dateOrdered.trim() ? today : line.dateOrdered,
  };
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
    case "Needs Revision":
      return "pill-revision";
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
    case "Needs Revision":
      return "dot-revision";
    case "Submitted for Approval":
      return "dot-submitted";
    case "Submittal Ordered":
      return "dot-submittal-ordered";
    default:
      return "dot-not-started";
  }
}
