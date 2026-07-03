import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ManpowerMonthlyBudgetCard } from "../components/billing/ManpowerMonthlyBudgetCard";
import { ManpowerPlanCard } from "../components/billing/ManpowerPlanCard";
import { MonthBudgetCalculatorModal } from "../components/billing/MonthBudgetCalculatorModal";
import {
  currentMonthLabel,
  formatHoursCompact,
  formatManWeeksCompact,
  hoursToDateFromCalendar,
  manpowerHoursContext,
  type DerivedMonthHours,
} from "../lib/manpowerHours";
import { saveProjectBillingQuiet } from "../lib/projectBillingStorage";
import { supabase } from "../lib/supabase";
import { parseProjectBilling, totalPlannedHours, type ProjectBillingData } from "../types/projectBilling";
import type { ProjectForm } from "../types/database";
import { normalizeProject } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

function SummaryCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="billing-summary-card">
      <span className="billing-summary-label">{label}</span>
      <span className="billing-summary-value">{value}</span>
      {subtitle ? <span className="billing-summary-sub">{subtitle}</span> : null}
    </div>
  );
}

export function BillingPage() {
  const { project, projectId, setProject } = useOutletContext<Ctx>();

  const [billing, setBilling] = useState<ProjectBillingData>(() => parseProjectBilling(project.data));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calculatorMonth, setCalculatorMonth] = useState<DerivedMonthHours | null>(null);
  const [calculatorRevision, setCalculatorRevision] = useState(0);

  useEffect(() => {
    setBilling(parseProjectBilling(project.data));
  }, [project.data]);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single()
      .then(({ data, error: loadErr }) => {
        if (cancelled || loadErr || !data) return;
        setProject(normalizeProject(data));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setProject]);

  const applyBilling = useCallback(
    (next: ProjectBillingData) => {
      setBilling(next);
      setProject({ ...project, data: { ...(project.data as object), billing: next } as ProjectForm["data"] });
    },
    [project, setProject],
  );

  const persistQuiet = useCallback(
    async (next: ProjectBillingData) => {
      setSaving(true);
      setError(null);
      const err = await saveProjectBillingQuiet(projectId, next);
      setSaving(false);
      if (err) {
        setError(err);
        return false;
      }
      applyBilling(next);
      return true;
    },
    [applyBilling, projectId],
  );

  const projectStartIso = project.jobInfo.start_date ?? "";
  const projectEndIso = project.jobInfo.end_date ?? "";
  const { weekStarts } = manpowerHoursContext(billing, projectStartIso, projectEndIso);
  const totalHours = totalPlannedHours(billing);
  const hoursThroughMonth = hoursToDateFromCalendar(billing, projectStartIso, projectEndIso);
  const throughMonth = currentMonthLabel();

  const closeCalculator = useCallback(() => {
    setCalculatorMonth(null);
    setCalculatorRevision((n) => n + 1);
  }, []);

  return (
    <div className="stack billing-page">
      {error ? <div className="banner banner-error">{error}</div> : null}

      <div className="billing-summary-row billing-summary-row--four">
        <SummaryCard
          label="Total planned"
          value={formatHoursCompact(totalHours)}
          subtitle={`${formatManWeeksCompact(totalHours)} man-weeks · ${weekStarts.length} weeks`}
        />
        <SummaryCard
          label="Through current month"
          value={formatHoursCompact(hoursThroughMonth)}
          subtitle={`Cumulative planned hours through ${throughMonth}`}
        />
        <SummaryCard
          label="Man-weeks (total)"
          value={formatManWeeksCompact(totalHours)}
          subtitle="40 hrs = 1 man-week"
        />
        <SummaryCard
          label="Week columns"
          value={String(weekStarts.length)}
          subtitle="From project start through schedule"
        />
      </div>

      <ManpowerPlanCard
        billing={billing}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
        saving={saving}
        onBillingChange={setBilling}
        onPersistQuiet={persistQuiet}
      />

      <ManpowerMonthlyBudgetCard
        billing={billing}
        projectId={projectId}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
        calculatorRevision={calculatorRevision}
        onOpenMonth={setCalculatorMonth}
      />

      {calculatorMonth ? (
        <MonthBudgetCalculatorModal
          projectId={projectId}
          monthKey={calculatorMonth.key}
          monthLabel={calculatorMonth.label}
          plannedHours={calculatorMonth.hours}
          onClose={closeCalculator}
        />
      ) : null}

      <p className="muted small billing-manpower-caption">
        Hours saved to the project · cost/billable calculator stays in this browser only
      </p>
    </div>
  );
}
