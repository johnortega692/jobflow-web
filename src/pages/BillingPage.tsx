import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ManpowerMonthlyBudgetCard } from "../components/billing/ManpowerMonthlyBudgetCard";
import { ManpowerPlanCard } from "../components/billing/ManpowerPlanCard";
import { MonthBudgetCalculatorModal } from "../components/billing/MonthBudgetCalculatorModal";
import { useAuth } from "../contexts/AuthContext";
import {
  deriveMonthlyHours,
  manpowerHoursContext,
  type DerivedMonthHours,
} from "../lib/manpowerHours";
import { availableTransmittalContracts, parseProjectDataBlob, TRANSMITTAL_CONTRACT_LABELS, type TransmittalContract } from "../lib/jobInfo";
import { migrateLocalCalculatorIntoBilling } from "../lib/migrateManpowerCalculator";
import {
  resolveLaborProjectionContractValue,
  resolveLaborProjectionMaterialCost,
} from "../lib/laborProjectionContractValue";
import { loadBudgetLibrary } from "../lib/budgetLibrary";
import { fetchMaterialOrderSpend } from "../lib/materialOrderSpend";
import { commitProjectUpdate } from "../lib/projectActivity";
import { saveProjectBillingQuiet } from "../lib/projectBillingStorage";
import { syncBillingPhasesFromBudget } from "../lib/syncManpowerFromBudget";
import { syncProjectStartDateToManpower } from "../lib/syncProjectStartDate";
import { supabase } from "../lib/supabase";
import { canEditManpowerCells, canEditManpowerSchedule } from "../types/jobRoles";
import {
  defaultBudgetLibrary,
  normalizeBudgetMaker,
  type BudgetLibrary,
} from "../types/budgetMaker";
import {
  getMonthMaterialCost,
  parseProjectBilling,
  totalPlannedHours,
  type ProjectBillingData,
} from "../types/projectBilling";
import type { ProjectForm } from "../types/database";
import { normalizeProject, type Json } from "../types/database";
import { parseProjectTradeData } from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

export function BillingPage() {
  const { project, projectId, setProject } = useOutletContext<Ctx>();
  const { user, isAdmin, jobRole } = useAuth();
  const canEditSchedule = canEditManpowerSchedule(jobRole, isAdmin);
  const canEditCells = canEditManpowerCells(jobRole, isAdmin);

  const [billing, setBilling] = useState<ProjectBillingData>(() => parseProjectBilling(project.data));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calculatorMonth, setCalculatorMonth] = useState<DerivedMonthHours | null>(null);
  const [calculatorRevision, setCalculatorRevision] = useState(0);
  const [budgetLibrary, setBudgetLibrary] = useState<BudgetLibrary>(() => defaultBudgetLibrary());
  const syncingRef = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const billingRef = useRef(billing);
  billingRef.current = billing;

  const contracts = useMemo(() => availableTransmittalContracts(project), [project]);
  const [activeContract, setActiveContract] = useState<TransmittalContract>(() => contracts[0] ?? "paint");

  useEffect(() => {
    if (!contracts.includes(activeContract)) {
      setActiveContract(contracts[0] ?? "paint");
    }
  }, [activeContract, contracts]);

  const tradeData = useMemo(
    () => parseProjectTradeData(parseProjectDataBlob(project.data) as Json),
    [project.data],
  );
  const budgetMakerRaw = tradeData.budget_maker;

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

  // Sync Labor Projection rows from Budget Hours PDF cost codes.
  useEffect(() => {
    let cancelled = false;
    async function syncFromBudget() {
      if (syncingRef.current) return;
      const latest = projectRef.current;
      const budget = normalizeBudgetMaker(budgetMakerRaw, latest.job_name);
      const lib = user ? await loadBudgetLibrary(user.id) : defaultBudgetLibrary();
      if (cancelled) return;
      setBudgetLibrary(lib);
      const current = billingRef.current;
      const { billing: synced, changed } = syncBillingPhasesFromBudget(
        current,
        budget,
        lib,
        contracts,
      );
      const { billing: migrated, changed: migratedCalc } = migrateLocalCalculatorIntoBilling(
        projectId,
        synced,
      );
      if (cancelled) return;
      setBilling(migrated);
      if (!changed && !migratedCalc) return;
      syncingRef.current = true;
      const err = await saveProjectBillingQuiet(projectId, migrated);
      syncingRef.current = false;
      if (cancelled) return;
      if (err) {
        setError(err);
        return;
      }
      const fresh = projectRef.current;
      setProject({
        ...fresh,
        data: { ...(fresh.data as object), billing: migrated } as ProjectForm["data"],
      });
    }
    void syncFromBudget();
    return () => {
      cancelled = true;
    };
  }, [budgetMakerRaw, contracts, project.job_name, projectId, setProject, user]);

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
  const budgetMaker = useMemo(
    () => normalizeBudgetMaker(budgetMakerRaw, project.job_name),
    [budgetMakerRaw, project.job_name],
  );
  const activeContracts = useMemo(() => [activeContract] as TransmittalContract[], [activeContract]);
  const activePhaseIds = useMemo(() => {
    const ids = billing.manpowerPhases
      .filter((p) => p.contract === activeContract)
      .map((p) => p.id);
    return new Set(ids);
  }, [activeContract, billing.manpowerPhases]);

  const contractValues = useMemo(() => {
    const map = {} as Record<TransmittalContract, number>;
    for (const contract of contracts) {
      map[contract] = resolveLaborProjectionContractValue(project, budgetMaker, [contract]);
    }
    return map;
  }, [budgetMaker, contracts, project]);
  const contractValue = contractValues[activeContract] ?? 0;
  const materialBudget = useMemo(
    () => resolveLaborProjectionMaterialCost(budgetMaker, activeContracts, budgetLibrary),
    [activeContracts, budgetLibrary, budgetMaker],
  );
  const [orderedMaterial, setOrderedMaterial] = useState<number | null>(null);
  const [orderedByMonth, setOrderedByMonth] = useState<Record<string, number>>({});
  const [materialTaxPercent, setMaterialTaxPercent] = useState(0);
  useEffect(() => {
    const job = project.job_number?.trim() ?? "";
    if (!job) {
      setOrderedMaterial(null);
      setOrderedByMonth({});
      setMaterialTaxPercent(0);
      return;
    }
    let cancelled = false;
    void fetchMaterialOrderSpend(job).then((spend) => {
      if (cancelled) return;
      setOrderedMaterial(spend?.ordered ?? null);
      setMaterialTaxPercent(spend?.taxPercent ?? 0);
      const byMonth: Record<string, number> = {};
      for (const row of spend?.months ?? []) byMonth[row.month] = row.amount;
      setOrderedByMonth(byMonth);
    });
    return () => {
      cancelled = true;
    };
  }, [project.job_number]);
  const monthlyHours = useMemo(
    () => deriveMonthlyHours(billing, weekStarts, activePhaseIds),
    [activePhaseIds, billing, weekStarts],
  );
  const calculatorMonthContext = useMemo(() => {
    if (!calculatorMonth) return null;
    void calculatorRevision;
    let running = 0;
    let materialEnteredOtherMonths = 0;
    for (const m of monthlyHours) {
      if (m.key !== calculatorMonth.key) {
        materialEnteredOtherMonths += getMonthMaterialCost(billing, m.key);
      }
      const prev = running;
      running += m.hours;
      if (m.key === calculatorMonth.key) {
        return {
          prevCumulativeHours: prev,
          cumulativeHours: running,
          totalPlannedHours: monthlyHours.reduce((sum, x) => sum + x.hours, 0),
          materialEnteredOtherMonths,
        };
      }
    }
    return {
      prevCumulativeHours: 0,
      cumulativeHours: calculatorMonth.hours,
      totalPlannedHours: totalHours,
      materialEnteredOtherMonths,
    };
  }, [billing, calculatorMonth, calculatorRevision, monthlyHours, totalHours]);

  const closeCalculator = useCallback(() => {
    setCalculatorMonth(null);
    setCalculatorRevision((n) => n + 1);
  }, []);

  return (
    <div className="stack billing-page">
      {error ? <div className="banner banner-error">{error}</div> : null}

      <ManpowerPlanCard
        billing={billing}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
        saving={saving}
        canEditSchedule={canEditSchedule}
        canEditCells={canEditCells}
        contracts={contracts}
        activeContract={activeContract}
        contractValues={contractValues}
        onActiveContractChange={setActiveContract}
        onBillingChange={setBilling}
        onPersistQuiet={persistQuiet}
        onScheduleDatesChange={persistScheduleDates}
        projectId={projectId}
        jobNumber={project.job_number}
        jobName={project.job_name}
        monthlyBilling={
          <ManpowerMonthlyBudgetCard
            embedded
            billing={billing}
            projectStartIso={projectStartIso}
            projectEndIso={projectEndIso}
            contractValue={contractValue}
            materialBudget={materialBudget}
            orderedMaterial={orderedMaterial}
            orderedByMonth={orderedByMonth}
            materialTaxPercent={materialTaxPercent}
            phaseIds={activePhaseIds}
            contract={activeContract}
            contractLabel={TRANSMITTAL_CONTRACT_LABELS[activeContract]}
            calculatorRevision={calculatorRevision}
            onOpenMonth={setCalculatorMonth}
            onPersistQuiet={persistQuiet}
          />
        }
      />

      {calculatorMonth && calculatorMonthContext ? (
        <MonthBudgetCalculatorModal
          billing={billing}
          monthKey={calculatorMonth.key}
          monthLabel={calculatorMonth.label}
          plannedHours={calculatorMonth.hours}
          cumulativeHours={calculatorMonthContext.cumulativeHours}
          prevCumulativeHours={calculatorMonthContext.prevCumulativeHours}
          totalPlannedHours={calculatorMonthContext.totalPlannedHours}
          contractValue={contractValue}
          materialBudget={materialBudget}
          materialEnteredOtherMonths={calculatorMonthContext.materialEnteredOtherMonths}
          orderedThisMonth={orderedByMonth[calculatorMonth.key] ?? 0}
          orderedTotal={orderedMaterial ?? 0}
          onPersistQuiet={persistQuiet}
          onClose={closeCalculator}
        />
      ) : null}
    </div>
  );
}
