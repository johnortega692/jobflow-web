import type { PaintTrackerState, WcTrackerLineState } from "../types/fieldTracker.js";
import { formatDateDisplay } from "./dateInputUtils.js";

export type PaintFieldStatus =
  | "Not Started"
  | "Match Existing"
  | "Submittal Ordered"
  | "Submitted for Approval"
  | "Needs Revision"
  | "Approved"
  | "Not Needed";

export type WcFieldStatus =
  | "Not Started"
  | "Submittal Ordered"
  | "Submitted for Approval"
  | "Needs Revision"
  | "Approved"
  | "Material Ordered"
  | "Delivered";

export function paintFieldStatus(tracker: PaintTrackerState): PaintFieldStatus {
  if (tracker.noPaint) return "Not Needed";
  if (tracker.revision && !tracker.approved) return "Needs Revision";
  if (tracker.approved) return "Approved";
  if (tracker.submittedForApproval) return "Submitted for Approval";
  if (tracker.submittalOrdered) return "Submittal Ordered";
  if (tracker.matchExisting) return "Match Existing";
  return "Not Started";
}

/** Weekly digest "Needs Submittal Ordering" — Not Needed / approved / in-progress jobs stay out. */
export function paintNeedsSubmittalOrdering(tracker: PaintTrackerState): boolean {
  if (tracker.noPaint) return false;
  if (tracker.approved || tracker.revision || tracker.submittedForApproval || tracker.submittalOrdered) {
    return false;
  }
  return true;
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

export type SubmittalCardStepId = "ordered" | "submitted" | "revision" | "approved";

export type SubmittalCardStep = {
  id: SubmittalCardStepId;
  label: string;
  done: boolean;
  current: boolean;
};

export type SubmittalCardState = {
  status: PaintFieldStatus;
  statusLabel: string;
  description: string;
  steps: SubmittalCardStep[];
  showSteps: boolean;
  tone: "approved" | "revision" | "progress" | "idle" | "skip";
};

export function paintSubmittalStatusDescription(status: PaintFieldStatus): string {
  switch (status) {
    case "Not Needed":
      return "No paint submittal is required for this job.";
    case "Match Existing":
      return "This job is matching existing paint instead of a new submittal.";
    case "Not Started":
      return "Submittal has not been ordered yet.";
    case "Submittal Ordered":
      return "Submittal is ordered and waiting to be sent for approval.";
    case "Submitted for Approval":
      return "Submittal was sent to the GC and is waiting for approval.";
    case "Needs Revision":
      return "GC requested changes. Submittal needs to be revised and resubmitted.";
    case "Approved":
      return "Paint submittal is approved.";
  }
}

export function paintSubmittalCardState(tracker: PaintTrackerState): SubmittalCardState {
  const status = paintFieldStatus(tracker);
  const statusLabel = paintStatusLabel(status);
  const description = paintSubmittalStatusDescription(status);
  const skipPath = status === "Not Needed" || status === "Match Existing";

  let tone: SubmittalCardState["tone"] = "progress";
  if (status === "Approved") tone = "approved";
  else if (status === "Needs Revision") tone = "revision";
  else if (skipPath) tone = "skip";
  else if (status === "Not Started") tone = "idle";

  let currentId: SubmittalCardStepId | null = null;
  if (status === "Not Started" || status === "Submittal Ordered") currentId = "ordered";
  else if (status === "Submitted for Approval") currentId = "submitted";
  else if (status === "Needs Revision") currentId = "revision";
  else if (status === "Approved") currentId = "approved";

  const orderedDone = tracker.submittalOrdered || tracker.approved;
  const submittedDone = tracker.submittedForApproval || tracker.approved;
  const revisionDone = tracker.approved || (tracker.revision && currentId !== "revision");
  const approvedDone = tracker.approved;

  return {
    status,
    statusLabel,
    description,
    showSteps: !skipPath,
    tone,
    steps: [
      {
        id: "ordered",
        label: "Submittal Ordered",
        done: orderedDone && currentId !== "ordered",
        current: currentId === "ordered",
      },
      {
        id: "submitted",
        label: "Sent for Approval",
        done: submittedDone && currentId !== "submitted",
        current: currentId === "submitted",
      },
      {
        id: "revision",
        label: "Needs Revision",
        done: Boolean(revisionDone && currentId !== "revision"),
        current: currentId === "revision",
      },
      {
        id: "approved",
        label: "Approved",
        done: approvedDone,
        current: currentId === "approved",
      },
    ],
  };
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

/** Filling Date Ordered marks Material Ordered. Clearing the date does not roll the stage back. */
export function applyWcDateOrdered(line: WcTrackerLineState, dateOrdered: string): WcTrackerLineState {
  if (!dateOrdered.trim()) return { ...line, dateOrdered };
  if (line.delivered || line.materialOrder) return { ...line, dateOrdered };
  return { ...applyWcLineStage(line, "Material Ordered"), dateOrdered };
}

export function paintPillClass(status: PaintFieldStatus): string {
  switch (status) {
    case "Not Needed":
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
