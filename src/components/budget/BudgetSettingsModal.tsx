import { useState } from "react";
import { saveBudgetLibrary } from "../../lib/budgetLibrary";
import { dedupeCostClassesByClass, dedupeCostCodeRecords } from "../../lib/budgetMakerCore";
import type { BudgetLibrary, BudgetMakerData, CostClassRecord, CostCodeRecord } from "../../types/budgetMaker";
import { BudgetBucketsPanel } from "./BudgetBucketsModal";
import { BudgetCostClassesPanel } from "./BudgetCostClassesPanel";
import { BudgetCostCodesPanel } from "./BudgetCostCodesPanel";

export type BudgetSettingsTab = "codes" | "classes" | "buckets";

const TABS: { id: BudgetSettingsTab; label: string }[] = [
  { id: "codes", label: "Cost codes" },
  { id: "classes", label: "Cost classes" },
  { id: "buckets", label: "Buckets & templates" },
];

type Props = {
  userId: string;
  library: BudgetLibrary;
  draft: BudgetMakerData;
  initialTab?: BudgetSettingsTab;
  onClose: () => void;
  onChange: (patch: Partial<BudgetMakerData>) => void;
  onLibraryChange: (lib: BudgetLibrary) => void;
  onLibrarySaved: (lib: BudgetLibrary) => void;
};

export function BudgetSettingsModal({
  userId,
  library,
  draft,
  initialTab = "codes",
  onClose,
  onChange,
  onLibraryChange,
  onLibrarySaved,
}: Props) {
  const [tab, setTab] = useState<BudgetSettingsTab>(initialTab);
  const [codes, setCodes] = useState<CostCodeRecord[]>(() => [...library.cost_codes]);
  const [classes, setClasses] = useState<CostClassRecord[]>(() => [...library.cost_classes]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveLibrary() {
    setSaving(true);
    setError(null);
    const next: BudgetLibrary = {
      ...library,
      cost_codes: dedupeCostCodeRecords(codes),
      cost_classes: dedupeCostClassesByClass(classes),
    };
    const err = await saveBudgetLibrary(userId, next);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onLibraryChange(next);
    onLibrarySaved(next);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card stack budget-modal budget-modal-wide budget-settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <h2>Budget options</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="budget-settings-tabs" role="tablist" aria-label="Budget options">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`budget-settings-tab${tab === item.id ? " budget-settings-tab--active" : ""}`}
              onClick={() => {
                setTab(item.id);
                setError(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="budget-settings-tab-body">
          {tab === "codes" && (
            <BudgetCostCodesPanel
              codes={codes}
              onCodesChange={setCodes}
              onClassesChange={setClasses}
              onError={setError}
            />
          )}
          {tab === "classes" && (
            <BudgetCostClassesPanel classes={classes} onClassesChange={setClasses} onError={setError} />
          )}
          {tab === "buckets" && (
            <BudgetBucketsPanel
              userId={userId}
              library={library}
              draft={draft}
              onChange={onChange}
              onLibraryChange={onLibraryChange}
              onError={setError}
            />
          )}
        </div>

        <div className="row-between budget-settings-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tab === "buckets" ? "Done" : "Cancel"}
          </button>
          {tab !== "buckets" ? (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveLibrary()}>
              {saving ? "Saving…" : "Save library"}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  );
}
