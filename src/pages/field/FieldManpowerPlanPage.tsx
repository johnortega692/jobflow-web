import { useCallback, useEffect, useState } from "react";
import { ManpowerPlanCard } from "../../components/billing/ManpowerPlanCard";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  billingFromLaborProjection,
  formatBudgetMakerHours,
  formatLaborHours,
  getFieldLaborProjection,
  listFieldLaborProjections,
  saveFieldLaborProjectionCells,
  type FieldLaborProjectionSummary,
} from "../../lib/fieldLaborProjection";
import { loadFieldViewSession } from "../../lib/fieldViewAuth";
import { openManpowerCalHandoff } from "../../lib/manpowerCalUrl";
import { formatJobDateLabel } from "../../lib/manpowerCalendar";
import type { ProjectBillingData } from "../../types/projectBilling";
import { FieldLoadingPanel, useFieldDashboard } from "./FieldDashboardLayout";

function LaborHoursStatCards({ plan }: { plan: FieldLaborProjectionSummary }) {
  // Variance = projected − budgeted (positive = over, negative = under)
  const variance = plan.projectionHours - plan.budgetHours;
  const tone = variance > 0 ? "over" : variance < 0 ? "under" : "even";
  const statusLabel = variance > 0 ? "Over budget" : variance < 0 ? "Under budget" : "On budget";
  const varianceText =
    variance > 0
      ? `+${formatLaborHours(variance)}`
      : formatLaborHours(variance);

  return (
    <div className="field-labor-stat-row" role="group" aria-label="Budget vs projection hours">
      <div className="field-labor-stat-card">
        <span className="field-labor-stat-label">Budgeted</span>
        <span className="field-labor-stat-value">{formatBudgetMakerHours(plan.budgetHours)}</span>
        <span className="field-labor-stat-unit">hrs</span>
      </div>
      <div className="field-labor-stat-card">
        <span className="field-labor-stat-label">Projected</span>
        <span className="field-labor-stat-value">{formatLaborHours(plan.projectionHours)}</span>
        <span className="field-labor-stat-unit">hrs</span>
      </div>
      <div className={`field-labor-stat-card field-labor-stat-card--${tone}`}>
        <span className="field-labor-stat-label">Variance</span>
        <span className="field-labor-stat-value">{varianceText}</span>
        <span className="field-labor-stat-unit field-labor-stat-status">{statusLabel}</span>
      </div>
    </div>
  );
}

export function FieldManpowerPlanPage() {
  const { toast, mobileView } = useFieldDashboard();
  const { user } = useAuth();
  const { profile } = useLetterhead();
  const [plans, setPlans] = useState<FieldLaborProjectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<FieldLaborProjectionSummary | null>(null);
  const [billing, setBilling] = useState<ProjectBillingData | null>(null);
  const [saving, setSaving] = useState(false);

  const actorName = user
    ? profile.name.trim() || user.email?.trim() || "Office"
    : loadFieldViewSession()?.name.trim() || "Field view";

  const reloadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listFieldLaborProjections();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setPlans([]);
      return;
    }
    setPlans(result.plans);
  }, []);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  const openPlan = useCallback(async (projectId: string) => {
    setSelectedId(projectId);
    setError(null);
    setLoading(true);
    const result = await getFieldLaborProjection(projectId);
    setLoading(false);
    if (result.error || !result.plan) {
      setError(result.error ?? "Could not load Labor Projection.");
      setPlan(null);
      setBilling(null);
      return;
    }
    setPlan(result.plan);
    setBilling(billingFromLaborProjection(result.plan));
  }, []);

  const persistQuiet = useCallback(
    async (next: ProjectBillingData) => {
      if (!plan) return false;
      setSaving(true);
      const result = await saveFieldLaborProjectionCells(plan.projectId, next.manpowerCells, actorName);
      setSaving(false);
      if (result.error || !result.plan) {
        setError(result.error ?? "Save failed");
        toast(result.error ?? "Could not save Labor Projection");
        return false;
      }
      setPlan(result.plan);
      setBilling(billingFromLaborProjection(result.plan));
      setPlans((prev) =>
        prev.map((p) => (p.projectId === result.plan!.projectId ? result.plan! : p)),
      );
      return true;
    },
    [actorName, plan, toast],
  );

  if (loading && !plan && !selectedId) {
    return <FieldLoadingPanel message="Loading Labor Projection…" />;
  }

  if (selectedId && plan && billing) {
    return (
      <div
        className={`stack field-labor-page field-labor-page--detail${mobileView ? " field-labor-page--mobile" : ""}`}
      >
        <header className="field-labor-detail-header">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectedId(null)}>
            ← Jobs
          </button>
          <div className="field-labor-detail-identity">
            <h2 className="field-labor-job-title">
              {plan.jobNumber}
              {plan.jobName ? ` — ${plan.jobName}` : ""}
            </h2>
            <p className="muted small field-labor-detail-meta">PM sets start/finish · edit cells below</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small field-labor-cal-btn"
            onClick={() => void openManpowerCalHandoff(loadFieldViewSession(), toast)}
          >
            Manpower Cal
          </button>
        </header>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <LaborHoursStatCards plan={plan} />

        <ManpowerPlanCard
          billing={billing}
          projectStartIso={plan.startDate}
          projectEndIso={plan.endDate}
          saving={saving}
          canEditSchedule={false}
          canEditCells
          variant="field"
          onBillingChange={setBilling}
          onPersistQuiet={persistQuiet}
        />
      </div>
    );
  }

  return (
    <div className={`stack field-labor-page field-labor-page--list${mobileView ? " field-labor-page--mobile" : ""}`}>
      <header className="field-labor-list-header">
        <div>
          <p className="muted small field-labor-list-lead">
            Total hours from the budget vs hours in the projection — open a job to edit the full schedule.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => void openManpowerCalHandoff(loadFieldViewSession(), toast)}
        >
          Manpower Cal
        </button>
      </header>

      {error ? <div className="banner banner-error">{error}</div> : null}
      {loading ? <FieldLoadingPanel message="Loading jobs…" /> : null}
      {!loading && plans.length === 0 ? (
        <p className="muted">No jobs available.</p>
      ) : (
        <ul className="field-labor-job-grid">
          {plans.map((p) => (
            <li key={p.projectId}>
              <button type="button" className="field-labor-job-item" onClick={() => void openPlan(p.projectId)}>
                <span className="field-labor-job-item-title">
                  {p.jobNumber}
                  {p.jobName ? ` — ${p.jobName}` : ""}
                </span>
                <span className="muted small field-labor-job-item-dates">
                  {formatJobDateLabel(p.startDate) || "No start"}
                  {p.endDate ? ` → ${formatJobDateLabel(p.endDate)}` : ""}
                </span>
                <LaborHoursStatCards plan={p} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
