import { useCallback, useEffect, useMemo, useState } from "react";
import { BudgetCostClassesPanel } from "../budget/BudgetCostClassesPanel";
import { BudgetCostCodesPanel } from "../budget/BudgetCostCodesPanel";
import { BudgetTemplatesPanel } from "../budget/BudgetTemplatesPanel";
import { useAuth } from "../../contexts/AuthContext";
import { loadBudgetLibrary, saveBudgetLibrary } from "../../lib/budgetLibrary";
import { dedupeCostClassesByClass, dedupeCostCodeRecords } from "../../lib/budgetMakerCore";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import {
  defaultBudgetLibrary,
  type BudgetLibrary,
  type CostClassRecord,
  type CostCodeRecord,
} from "../../types/budgetMaker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

type CatalogTab = "codes" | "classes" | "templates";

const TABS: { id: CatalogTab; label: string }[] = [
  { id: "codes", label: "Cost codes" },
  { id: "classes", label: "Cost classes" },
  { id: "templates", label: "Templates" },
];

type TrackData = {
  codes: CostCodeRecord[];
  classes: CostClassRecord[];
  templates: BudgetLibrary["bucket_templates"];
  defaultTemplate: string;
};

export function BudgetCatalogSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [tab, setTab] = useState<CatalogTab>("codes");
  const [library, setLibrary] = useState<BudgetLibrary>(defaultBudgetLibrary);
  const [codes, setCodes] = useState<CostCodeRecord[]>([]);
  const [classes, setClasses] = useState<CostClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trackData = useMemo<TrackData>(
    () => ({
      codes,
      classes,
      templates: library.bucket_templates,
      defaultTemplate: library.default_bucket_template,
    }),
    [codes, classes, library.bucket_templates, library.default_bucket_template],
  );
  const ready = !loading && Boolean(user?.id);
  const { markSaved, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  const reload = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const lib = await loadBudgetLibrary(user.id);
      setLibrary(lib);
      setCodes([...lib.cost_codes]);
      setClasses([...lib.cost_classes]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load budget catalog");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || readOnly) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const next: BudgetLibrary = {
      ...library,
      cost_codes: dedupeCostCodeRecords(codes),
      cost_classes: dedupeCostClassesByClass(classes),
    };
    const err = await saveBudgetLibrary(user.id, next);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    setLibrary(next);
    setCodes([...next.cost_codes]);
    setClasses([...next.cost_classes]);
    markSaved();
    setMessage("Budget catalog saved for everyone.");
    return true;
  }, [user?.id, readOnly, library, codes, classes, markSaved]);

  useEffect(() => {
    onBindActions?.({
      save: persist,
      discard: () => void reload(),
      getIsDirty,
    });
  }, [onBindActions, persist, reload, getIsDirty]);

  if (loading) return <p className="muted">Loading budget catalog…</p>;

  return (
    <div className="stack">
      {readOnly && <SharedSettingsNotice />}
      <p className="muted small">
        Company cost codes, classes, and bucket templates used by Budget Maker on every job.
      </p>

      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <div className="budget-settings-tabs" role="tablist" aria-label="Budget catalog">
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
              setMessage(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="budget-settings-tab-body">
        {tab === "codes" && (
          <BudgetCostCodesPanel
            codes={codes}
            onCodesChange={readOnly ? () => undefined : setCodes}
            onClassesChange={readOnly ? () => undefined : setClasses}
            onError={setError}
          />
        )}
        {tab === "classes" && (
          <BudgetCostClassesPanel
            classes={classes}
            onClassesChange={readOnly ? () => undefined : setClasses}
            onError={setError}
          />
        )}
        {tab === "templates" && (
          <BudgetTemplatesPanel
            library={{ ...library, cost_codes: codes, cost_classes: classes }}
            readOnly={readOnly}
            onError={setError}
            onLibraryChange={(next) => {
              setLibrary(next);
              setError(null);
              setMessage(null);
            }}
          />
        )}
      </div>

      {!readOnly && (
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save budget catalog"}
          </button>
        </div>
      )}
    </div>
  );
}
