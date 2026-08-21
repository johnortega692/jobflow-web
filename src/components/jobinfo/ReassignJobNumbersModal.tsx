import { useEffect, useState } from "react";
import {
  findOtherProjectWithJobNumber,
  paintWcReassignMode,
  reassignCurrentJobNumberToWallcovering,
  swapPaintAndWallcoveringJobNumbers,
  type ApplyPaintWcReassignResult,
} from "../../lib/reassignPaintWallcovering";
import type { ProjectForm } from "../../types/database";

type Props = {
  open: boolean;
  project: ProjectForm;
  projectId: string;
  onClose: () => void;
  onApply: (result: Extract<ApplyPaintWcReassignResult, { ok: true }>) => void;
};

export function ReassignJobNumbersModal({ open, project, projectId, onClose, onApply }: Props) {
  const mode = paintWcReassignMode(project);
  const [newPaintJobNumber, setNewPaintJobNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNewPaintJobNumber("");
    setError(null);
  }, [open, project.job_number, project.jobInfo.wc_job_number]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const currentPaint = project.job_number.trim();
  const currentWc = project.jobInfo.wc_job_number.trim();

  async function confirmReassign() {
    const result = reassignCurrentJobNumberToWallcovering(project, newPaintJobNumber);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChecking(true);
    setError(null);
    const duplicate = await findOtherProjectWithJobNumber(result.job_number, projectId);
    setChecking(false);
    if (duplicate) {
      const status = duplicate.isDone ? "marked completed" : "still active";
      const existingName = duplicate.job_name.trim() || "Untitled job";
      const ok = window.confirm(
        `Job number "${duplicate.job_number}" is already used by "${existingName}" (${status}).\n\nUse it as this project's paint job # anyway?`,
      );
      if (!ok) return;
    }
    onApply(result);
  }

  function confirmSwap() {
    const result = swapPaintAndWallcoveringJobNumbers(project);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onApply(result);
  }

  return (
    <div className="modal-backdrop job-info-reassign-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack job-info-reassign-modal"
        role="dialog"
        aria-labelledby="reassign-job-numbers-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "swap" ? (
          <>
            <h3 id="reassign-job-numbers-title">Swap paint and wallcovering job numbers</h3>
            <p className="muted small">
              Use this when the office flipped the two contract numbers. Paint submittals stay on this
              project; generate PDFs again after Save so covers use the new paint number.
            </p>
            <p>
              Paint <strong>{currentPaint}</strong>
              {project.job_name.trim() ? ` · ${project.job_name.trim()}` : ""} becomes wallcovering.
            </p>
            <p>
              Wallcovering <strong>{currentWc}</strong>
              {project.jobInfo.wc_job_name.trim() ? ` · ${project.jobInfo.wc_job_name.trim()}` : ""}{" "}
              becomes paint.
            </p>
            {error && <p className="banner banner-error">{error}</p>}
            <div className="row-gap wrap">
              <button type="button" className="btn btn-primary" onClick={confirmSwap}>
                Swap numbers
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="reassign-job-numbers-title">This job # is actually wallcovering</h3>
            <p className="muted small">
              Keeps this project, moves <strong>{currentPaint || "the current job #"}</strong> to
              wallcovering, and sets a new paint job #. Paint submittals stay on this project; generate
              PDFs after Save so they show the new paint number.
            </p>
            <label>
              Real paint job #
              <input
                value={newPaintJobNumber}
                onChange={(e) => setNewPaintJobNumber(e.target.value)}
                placeholder="Paint contract number"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirmReassign();
                  }
                }}
              />
            </label>
            {error && <p className="banner banner-error">{error}</p>}
            <div className="row-gap wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={checking}
                onClick={() => void confirmReassign()}
              >
                {checking ? "Checking…" : "Move current # to wallcovering"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
