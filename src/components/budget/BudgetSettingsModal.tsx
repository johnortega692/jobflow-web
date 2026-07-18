import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { BudgetBucketsPanel } from "./BudgetBucketsModal";
import type { BudgetLibrary, BudgetMakerData } from "../../types/budgetMaker";

type Props = {
  userId: string;
  library: BudgetLibrary;
  draft: BudgetMakerData;
  onClose: () => void;
  onChange: (patch: Partial<BudgetMakerData>) => void;
  onLibraryChange: (lib: BudgetLibrary) => void;
  /** When true, show admin template save/delete/default controls. */
  canEditCatalog?: boolean;
};

export function BudgetBucketsModal({
  userId,
  library,
  draft,
  onClose,
  onChange,
  onLibraryChange,
  canEditCatalog = false,
}: Props) {
  const { isAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card stack budget-modal budget-modal-wide budget-settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <h2>Buckets</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="muted small">
          Load a company template or edit buckets for this job.
          {isAdmin && (
            <>
              {" "}
              Cost codes and classes are in{" "}
              <Link to="/settings" state={{ tab: "budget" }}>
                Settings → Budget
              </Link>
              .
            </>
          )}
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        <BudgetBucketsPanel
          userId={userId}
          library={library}
          draft={draft}
          onChange={onChange}
          onLibraryChange={onLibraryChange}
          onError={setError}
          canEditCatalog={canEditCatalog}
        />

        <div className="row-between budget-settings-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
          <span />
        </div>
      </div>
    </div>
  );
}

/** @deprecated Prefer BudgetBucketsModal */
export { BudgetBucketsModal as BudgetSettingsModal };
