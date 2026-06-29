import type { PaintTrackerState } from "../types/fieldTracker";

export type TrackerRevisionFields = {
  revision: boolean;
  revisionNotes: string;
};

/** @deprecated Notes no longer auto-toggle revision; kept for callers that read stored state as-is. */
export function harmonizeTrackerRevision<T extends TrackerRevisionFields>(state: T): T {
  return state;
}

/** @deprecated Use harmonizeTrackerRevision */
export function harmonizePaintTrackerRevision(state: PaintTrackerState): PaintTrackerState {
  return harmonizeTrackerRevision(state);
}

export function validateTrackerRevisionSave(
  next: TrackerRevisionFields,
  _lastSaved: TrackerRevisionFields,
): string | null {
  if (!next.revision) return null;

  const notes = next.revisionNotes.trim();
  if (!notes) {
    return "Enter revision notes — they appear on Field View when status is Needs Revision.";
  }

  return null;
}

/** @deprecated Use validateTrackerRevisionSave */
export function validatePaintTrackerRevisionSave(
  next: PaintTrackerState,
  lastSaved: PaintTrackerState,
): string | null {
  return validateTrackerRevisionSave(next, lastSaved);
}

export function applyTrackerRevisionPatch<T extends TrackerRevisionFields>(
  current: T,
  patch: Partial<T>,
  lastSaved: T,
): { next: T; validationError: string | null; scheduleSave: boolean } {
  let next = { ...current, ...patch };

  if ("revision" in patch && patch.revision === false) {
    // Keep notes text; revision off is enough to clear Needs Revision status.
  }

  if ("revision" in patch && patch.revision === true && !next.revisionNotes.trim()) {
    return {
      next: { ...next, revision: true },
      validationError: "Enter revision notes — they appear on Field View when status is Needs Revision.",
      scheduleSave: false,
    };
  }

  const validationError = validateTrackerRevisionSave(next, lastSaved);
  return {
    next,
    validationError,
    scheduleSave: !validationError,
  };
}

/** @deprecated Use applyTrackerRevisionPatch */
export function applyPaintTrackerRevisionPatch(
  current: PaintTrackerState,
  patch: Partial<PaintTrackerState>,
  lastSaved: PaintTrackerState,
): { next: PaintTrackerState; validationError: string | null; scheduleSave: boolean } {
  return applyTrackerRevisionPatch(current, patch, lastSaved);
}
