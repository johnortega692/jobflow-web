import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ManpowerMonthlyBudgetCard } from "../components/billing/ManpowerMonthlyBudgetCard";
import { ManpowerPlanCard } from "../components/billing/ManpowerPlanCard";
import { MonthBudgetCalculatorModal } from "../components/billing/MonthBudgetCalculatorModal";
import { useAuth } from "../contexts/AuthContext";
import {
  currentMonthLabel,
  formatHoursCompact,
  formatManWeeksCompact,
  hoursToDateFromCalendar,
  manpowerHoursContext,
  type DerivedMonthHours,
} from "../lib/manpowerHours";
import { parseProjectDataBlob } from "../lib/jobInfo";
import { commitProjectUpdate } from "../lib/projectActivity";
import { saveProjectBillingQuiet } from "../lib/projectBillingStorage";
import { syncProjectStartDateToManpower } from "../lib/syncProjectStartDate";
import { supabase } from "../lib/supabase";
import { canEditManpowerCells, canEditManpowerSchedule } from "../types/jobRoles";
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
  const { isAdmin, jobRole } = useAuth();
  const canEditSchedule = canEditManpowerSchedule(jobRole, isAdmin);
  const canEditCells = canEditManpowerCells(jobRole, isAdmin);

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

  const persistScheduleDates = useCallback(
    async (startIso: string, endIso: string) => {
      if (!canEditSchedule) return false;
      setSaving(true);
      setError(null);
      const { data: row, error: loadErr } = await supabase
        .from("projects")
        .select("data")
        .eq("id", projectId)
        .single();
      if (loadErr) {
        setSaving(false);
        setError(loadErr.message);
        return false;
      }
      const base = parseProjectDataBlob(row?.data);
      const prevStart = project.jobInfo.start_date?.trim() ?? "";
      const jobInfo = {
        ...project.jobInfo,
        start_date: startIso,
        end_date: endIso,
      };
      const errMsg = await commitProjectUpdate({
        projectId,
        mergeData: { job_info: jobInfo },
        activity: {
          action: "job_info_saved",
          summary: "Labor Projection schedule dates updated",
        },
      });
      setSaving(false);
      if (errMsg) {
        setError(errMsg);
        return false;
      }
      setProject({
        ...project,
        jobInfo,
        data: { ...(base as object), job_info: jobInfo } as ProjectForm["data"],
      });
      if (startIso.trim() !== prevStart) {
        try {
          await syncProjectStartDateToManpower(projectId);
        } catch {
          /* best-effort */
        }
      }
      return true;
    },
    [canEditSchedule, project, projectId, setProject],
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
        canEditSchedule={canEditSchedule}
        canEditCells={canEditCells}
        onBillingChange={setBilling}
        onPersistQuiet={persistQuiet}
        onScheduleDatesChange={persistScheduleDates}
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
    </div>
  );
}
