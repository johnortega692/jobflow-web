import type { PaintTrackerState } from "../types/fieldTracker";

export type SubmittalPipelineTone = "default" | "revision" | "approved" | "match" | "skipped";

export type SubmittalPipelineStep = {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
  tone: SubmittalPipelineTone;
  /** Shown beside Approved when the submittal never went through a revision. */
  badge?: string;
  /** A standing tracker state, not a numbered pipeline step. */
  status?: boolean;
};

type PipelineFlags = Pick<
  PaintTrackerState,
  "submittalOrdered" | "submittedForApproval" | "revision" | "approved"
> &
  Partial<Pick<PaintTrackerState, "matchExisting" | "noPaint">>;

function wholeRevision(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Highest paint-package revision on the job. Rev 0 is the original and does not count. */
export function paintPackageRevisionNumber(data: unknown): number {
  if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
  const trade = data as {
    paint_submittal?: { revision_number?: unknown };
    paint_submittal_history?: { revision_number?: unknown }[] | null;
  };
  let max = wholeRevision(trade.paint_submittal?.revision_number);
  const history = Array.isArray(trade.paint_submittal_history) ? trade.paint_submittal_history : [];
  for (const entry of history) {
    max = Math.max(max, wholeRevision(entry?.revision_number));
  }
  return max;
}

function standingStatus(tracker: PipelineFlags): SubmittalPipelineStep | null {
  if (tracker.noPaint && tracker.matchExisting) {
    return { id: "match-existing", label: "Match Existing", done: false, current: false, tone: "match", status: true };
  }
  if (tracker.noPaint) {
    return { id: "not-needed", label: "Not Needed", done: false, current: false, tone: "skipped", status: true };
  }
  const inPipeline =
    tracker.submittalOrdered || tracker.submittedForApproval || tracker.revision || tracker.approved;
  if (tracker.matchExisting && !inPipeline) {
    return { id: "match-existing", label: "Match Existing", done: false, current: false, tone: "match", status: true };
  }
  return null;
}

/**
 * Ordered → Submitted → Revision N (only after a return) → Approved.
 * A first-pass approval never inserts a revision step.
 * Match Existing and Not Needed replace the pipeline unless a submittal is already underway.
 */
export function paintSubmittalPipelineSteps(
  tracker: PipelineFlags,
  revisionNumber = 0,
): SubmittalPipelineStep[] {
  const standing = standingStatus(tracker);
  if (standing) return [standing];

  const packageRev = wholeRevision(revisionNumber);
  const approved = tracker.approved;
  const revisionFlag = tracker.revision;

  let openRound: number | null = null;
  let completedRounds = 0;
  if (approved) {
    completedRounds = packageRev > 0 ? packageRev : revisionFlag ? 1 : 0;
  } else if (revisionFlag || packageRev > 0) {
    openRound = Math.max(packageRev, revisionFlag ? 1 : 0);
    completedRounds = Math.max(0, openRound - 1);
  }

  let active = "ordered";
  if (approved) active = "";
  else if (openRound) active = `revision-${openRound}`;
  else if (tracker.submittedForApproval || tracker.submittalOrdered) active = "submitted";

  const steps: SubmittalPipelineStep[] = [
    {
      id: "ordered",
      label: "Ordered",
      done: active !== "ordered",
      current: active === "ordered",
      tone: "default",
    },
    {
      id: "submitted",
      label: "Submitted",
      done: active !== "ordered" && active !== "submitted",
      current: active === "submitted",
      tone: "default",
    },
  ];

  for (let n = 1; n <= completedRounds; n += 1) {
    steps.push({
      id: `revision-${n}`,
      label: `Revision ${n}`,
      done: true,
      current: false,
      tone: "revision",
    });
  }
  if (openRound) {
    steps.push({
      id: `revision-${openRound}`,
      label: `Revision ${openRound}`,
      done: false,
      current: true,
      tone: "revision",
    });
  }

  const firstPass = approved && completedRounds === 0;
  steps.push({
    id: "approved",
    label: "Approved",
    done: approved,
    current: false,
    tone: approved ? "approved" : "default",
    badge: firstPass ? "First pass" : undefined,
  });

  return steps;
}
