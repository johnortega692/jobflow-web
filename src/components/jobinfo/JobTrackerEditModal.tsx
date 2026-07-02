import { JobTrackerPanel } from "./JobTrackerPanel";
import type { ProjectForm } from "../../types/database";

type Props = {
  open: boolean;
  project: ProjectForm;
  projectId: string;
  onClose: () => void;
  onOpenJobSetup: () => void;
  onProjectUpdate: (project: ProjectForm) => void;
};

export function JobTrackerEditModal({
  open,
  project,
  projectId,
  onClose,
  onOpenJobSetup,
  onProjectUpdate,
}: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack job-tracker-edit-modal"
        role="dialog"
        aria-labelledby="job-tracker-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <h2 id="job-tracker-edit-title" className="job-dashboard-section-title">
            Edit job tracker
          </h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <JobTrackerPanel
          project={project}
          projectId={projectId}
          onOpenJobSetup={() => {
            onClose();
            onOpenJobSetup();
          }}
          onProjectUpdate={onProjectUpdate}
          editorMode
        />
      </div>
    </div>
  );
}
