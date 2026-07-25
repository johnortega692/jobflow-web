import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateInput } from "../DateInput";
import {
  cellHours,
  formatJobDateLabel,
  hoursToManWeeks,
  manpowerEndDateHint,
  manpowerWeekStarts,
  phaseTotalHours,
  weekColumnLabel,
  weekHasPhaseOverlap,
  withCellHours,
} from "../../lib/manpowerCalendar";
import {
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../../lib/jobInfo";
import {
  HOURS_PER_MAN_WEEK,
  phaseColorAtIndex,
  phaseDisplayLabel,
  plannedHoursForPhase,
  type ManpowerPhase,
  type ManpowerPhaseId,
  type ProjectBillingData,
} from "../../types/projectBilling";
import { ManpowerHeaderPencilIcon } from "./ManpowerHeaderPillIcons";
import { ManpowerWeekDetailModal } from "./ManpowerWeekDetailModal";

type Props = {
  billing: ProjectBillingData;
  projectStartIso: string;
  projectEndIso: string;
  saving: boolean;
  canEditSchedule: boolean;
  canEditCells: boolean;
  /** office = JobFlow billing page; field = iPad/desktop Field View */
  variant?: "office" | "field";
  /** Contracts with a Labor Projection tab (from job + budget). */
  contracts?: TransmittalContract[];
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
  onScheduleDatesChange?: (startIso: string, endIso: string) => Promise<boolean>;
};

function cellKey(phaseId: ManpowerPhaseId, weekStartIso: string): string {
  return `${phaseId}:${weekStartIso}`;
}

/** Compact man-weeks display: 1 dp, no trailing .0 (e.g. 1.5, 2). */
function formatManWeeks(hours: number): string {
  if (hours <= 0) return "—";
  const mw = hoursToManWeeks(hours);
  return Number.isInteger(mw) ? String(mw) : mw.toFixed(1);
}

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function formatHoursPlain(hours: number): string {
  if (!Number.isFinite(hours) || hours === 0) return "0";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function ManpowerPlanCard({
  billing,
  projectStartIso,
  projectEndIso,
  saving,
  canEditSchedule,
  canEditCells,
  variant = "office",
  contracts: contractsProp,
  onBillingChange,
  onPersistQuiet,
  onScheduleDatesChange,
}: Props) {
  const contracts = useMemo<TransmittalContract[]>(() => {
    if (contractsProp?.length) return contractsProp;
    const fromPhases = [...new Set(billing.manpowerPhases.map((p) => p.contract))];
    return fromPhases.length ? fromPhases : ["paint"];
  }, [billing.manpowerPhases, contractsProp]);

  const [activeContract, setActiveContract] = useState<TransmittalContract>(
    () => contracts[0] ?? "paint",
  );

  useEffect(() => {
    if (!contracts.includes(activeContract)) {
      setActiveContract(contracts[0] ?? "paint");
    }
  }, [activeContract, contracts]);

  const contractPhases = useMemo(
    () => billing.manpowerPhases.filter((p) => p.contract === activeContract),
    [activeContract, billing.manpowerPhases],
  );

  const phaseIndexById = useMemo(() => {
    const map = new Map<string, number>();
    billing.manpowerPhases.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [billing.manpowerPhases]);

  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const endDateLabel = formatJobDateLabel(projectEndIso);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftHours, setDraftHours] = useState("");
  const [detailWeek, setDetailWeek] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState(projectStartIso);
  const [draftEnd, setDraftEnd] = useState(projectEndIso);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftStart(projectStartIso);
    setDraftEnd(projectEndIso);
  }, [projectStartIso, projectEndIso]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitHours = useCallback(
    async (phaseId: ManpowerPhaseId, weekStartIso: string, raw: string) => {
      if (!canEditCells) {
        setEditing(null);
        return;
      }
      const n = raw.trim() === "" ? 0 : Number(raw);
      const hours = Number.isFinite(n) && n >= 0 ? n : 0;
      const nextCells = withCellHours(billing.manpowerCells, phaseId, weekStartIso, hours);
      const next = { ...billing, manpowerCells: nextCells };
      onBillingChange(next);
      setEditing(null);
      await onPersistQuiet(next);
    },
    [billing, canEditCells, onBillingChange, onPersistQuiet],
  );

  const clearCell = useCallback(
    async (phaseId: ManpowerPhaseId, weekStartIso: string) => {
      if (!canEditCells) return;
      await commitHours(phaseId, weekStartIso, "");
    },
    [canEditCells, commitHours],
  );

  const saveWeekDetail = useCallback(
    async (next: ProjectBillingData) => {
      if (!canEditCells) return false;
      onBillingChange(next);
      return onPersistQuiet(next);
    },
    [canEditCells, onBillingChange, onPersistQuiet],
  );

  async function addWeek() {
    if (!canEditSchedule) return;
    const next = { ...billing, manpowerWeekCount: billing.manpowerWeekCount + 1 };
    onBillingChange(next);
    await onPersistQuiet(next);
  }

  async function persistDates(nextStart: string, nextEnd: string) {
    if (!canEditSchedule || !onScheduleDatesChange) return;
    if (nextStart === projectStartIso && nextEnd === projectEndIso) return;
    await onScheduleDatesChange(nextStart, nextEnd);
  }

  const isField = variant === "field";
  const showContractTabs = contracts.length > 1;

  const contractBudget = contractPhases.reduce((sum, p) => sum + p.budgetHours, 0);
  const contractPlanned = contractPhases.reduce(
    (sum, p) => sum + plannedHoursForPhase(p.id, billing.manpowerCells),
    0,
  );

  function rowMeta(phase: ManpowerPhase) {
    const planned = phaseTotalHours(billing.manpowerCells, phase.id);
    const left = phase.budgetHours - planned;
    const colors = phaseColorAtIndex(phaseIndexById.get(phase.id) ?? 0);
    return { planned, left, colors };
  }

  return (
    <section
      className={`card stack billing-card billing-manpower-card${isField ? " billing-manpower-card--field" : ""}`}
    >
      <div className="billing-manpower-toolbar">
        <div className="billing-manpower-toolbar-main">
          {!isField ? <h3 className="billing-card-title">Labor Projection</h3> : null}
          <div className="billing-manpower-schedule-row">
            <label>
              Start
              {canEditSchedule ? (
                <DateInput
                  value={draftStart}
                  onChange={(v) => {
                    setDraftStart(v);
                    void persistDates(v, draftEnd);
                  }}
                />
              ) : (
                <input className="readonly" readOnly value={formatJobDateLabel(projectStartIso) || "—"} />
              )}
            </label>
            <label>
              Finish
              {canEditSchedule ? (
                <DateInput
                  value={draftEnd}
                  onChange={(v) => {
                    setDraftEnd(v);
                    void persistDates(draftStart, v);
                  }}
                />
              ) : (
                <input className="readonly" readOnly value={formatJobDateLabel(projectEndIso) || "—"} />
              )}
            </label>
            <p className="muted small billing-manpower-week-count">
              {weeks.length} week{weeks.length === 1 ? "" : "s"}
              {endDateLabel ? ` · through ${endDateLabel}` : ""}
            </p>
          </div>
        </div>
        {canEditSchedule ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addWeek()} disabled={saving}>
            Add week
          </button>
        ) : null}
      </div>

      {showContractTabs ? (
        <div className="billing-manpower-contract-tabs" role="tablist" aria-label="Contract">
          {contracts.map((contract) => (
            <button
              key={contract}
              type="button"
              role="tab"
              aria-selected={activeContract === contract}
              className={`billing-manpower-contract-tab${activeContract === contract ? " active" : ""}`}
              onClick={() => setActiveContract(contract)}
            >
              {TRANSMITTAL_CONTRACT_LABELS[contract]}
            </button>
          ))}
        </div>
      ) : null}

      {contractPhases.length > 0 ? (
        <p className="muted small billing-manpower-contract-summary">
          {TRANSMITTAL_CONTRACT_LABELS[activeContract]} · budget {formatHoursPlain(contractBudget)} hrs · planned{" "}
          {formatHoursPlain(contractPlanned)} hrs · left {formatHoursPlain(contractBudget - contractPlanned)} hrs
        </p>
      ) : null}

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : !isField && endDateLabel && contractEndWeekIndex !== null ? (
        <p className="muted small billing-manpower-end-hint">
          Contract schedule through {endDateLabel} ({weeks.length} weeks) · scroll horizontally for all columns
        </p>
      ) : null}

      {contractPhases.length === 0 ? (
        <p className="muted small billing-manpower-empty">
          No Hours PDF lines for {TRANSMITTAL_CONTRACT_LABELS[activeContract]}. Unhide labor cost codes in Budget Maker
          to project this contract.
        </p>
      ) : (
        <div
          className="billing-manpower-scroll"
          tabIndex={0}
          aria-label="Labor Projection weeks — scroll horizontally"
        >
          <table className="billing-manpower-table">
            <thead>
              <tr>
                <th className="billing-manpower-sticky billing-manpower-phase-col">Cost code</th>
                <th className="billing-manpower-budget-col num">Budget</th>
                <th className="billing-manpower-budget-col num">Planned</th>
                <th className="billing-manpower-budget-col num">Left</th>
                {weeks.map((w, weekIdx) => (
                  <th
                    key={w}
                    className={`billing-manpower-week-col num${
                      contractEndWeekIndex !== null && weekIdx > contractEndWeekIndex
                        ? " billing-manpower-week-col--beyond-contract"
                        : ""
                    }`}
                  >
                    {canEditCells ? (
                      <button
                        type="button"
                        className="billing-manpower-header-pill"
                        onClick={() => setDetailWeek(w)}
                        title={`Plan daily hours for week of ${weekColumnLabel(w)}`}
                      >
                        <ManpowerHeaderPencilIcon />
                        {weekColumnLabel(w)}
                      </button>
                    ) : (
                      <span className="billing-manpower-header-pill billing-manpower-header-pill--readonly">
                        {weekColumnLabel(w)}
                      </span>
                    )}
                  </th>
                ))}
                <th className="billing-manpower-sticky billing-manpower-total-col num">Man-wks</th>
                <th className="billing-manpower-sticky billing-manpower-total-col num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {contractPhases.map((phase) => {
                const { planned, left, colors } = rowMeta(phase);
                const over = left < 0;
                return (
                  <tr key={phase.id}>
                    <td
                      className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-phase-name"
                      style={{ borderLeftColor: colors.border }}
                      title={phaseDisplayLabel(phase)}
                    >
                      <span className="billing-manpower-phase-code">{phase.costCode || "—"}</span>
                      <span className="billing-manpower-phase-desc">{phase.name}</span>
                    </td>
                    <td className="billing-manpower-budget-col num">
                      {formatHours(phase.budgetHours)}
                    </td>
                    <td className="billing-manpower-budget-col num">
                      {formatHours(planned)}
                    </td>
                    <td
                      className={`billing-manpower-budget-col num${over ? " billing-manpower-left--over" : ""}`}
                    >
                      {formatHoursPlain(left)}
                    </td>
                    {weeks.map((w) => {
                      const hrs = cellHours(billing.manpowerCells, phase.id, w);
                      const key = cellKey(phase.id, w);
                      const isEditing = editing === key;
                      return (
                        <td key={w} className="billing-manpower-week-col">
                          {isEditing && canEditCells ? (
                            <input
                              ref={inputRef}
                              type="number"
                              min={0}
                              step={0.5}
                              className="billing-manpower-cell-input"
                              value={draftHours}
                              onChange={(e) => setDraftHours(e.target.value)}
                              onBlur={() => void commitHours(phase.id, w, draftHours)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitHours(phase.id, w, draftHours);
                                if (e.key === "Escape") setEditing(null);
                                if (e.key === "Delete" || e.key === "Backspace") {
                                  if (draftHours === "") void clearCell(phase.id, w);
                                }
                              }}
                              placeholder="hrs"
                              title="Enter hours · clear to remove"
                            />
                          ) : (
                            <button
                              type="button"
                              className={`billing-manpower-chip${hrs > 0 ? "" : " billing-manpower-chip--empty"}`}
                              style={
                                hrs > 0
                                  ? {
                                      background: colors.bg,
                                      borderColor: colors.border,
                                      color: colors.text,
                                    }
                                  : undefined
                              }
                              disabled={!canEditCells}
                              onClick={() => {
                                if (!canEditCells) return;
                                setEditing(key);
                                setDraftHours(hrs > 0 ? String(hrs) : "");
                              }}
                              onContextMenu={(e) => {
                                if (!canEditCells || hrs <= 0) return;
                                e.preventDefault();
                                void clearCell(phase.id, w);
                              }}
                              title={
                                hrs > 0
                                  ? `${formatHours(hrs)} hrs · ${formatManWeeks(hrs)} man-wk · right-click to clear`
                                  : canEditCells
                                    ? "Add hours"
                                    : "View only"
                              }
                              aria-label={`${phaseDisplayLabel(phase)} week ${weekColumnLabel(w)} hours`}
                            >
                              {hrs > 0 ? formatHours(hrs) : "—"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="billing-manpower-sticky billing-manpower-total-col num">
                      {formatManWeeks(planned)}
                    </td>
                    <td className="billing-manpower-sticky billing-manpower-total-col num">
                      {formatHours(planned)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="billing-manpower-total-row">
                <td className="billing-manpower-sticky billing-manpower-phase-col">Total hrs</td>
                <td className="billing-manpower-budget-col num">
                  {formatHours(contractBudget)}
                </td>
                <td className="billing-manpower-budget-col num">
                  {formatHours(contractPlanned)}
                </td>
                <td className="billing-manpower-budget-col num">
                  {formatHoursPlain(contractBudget - contractPlanned)}
                </td>
                {weeks.map((w) => {
                  const phaseIds = new Set(contractPhases.map((p) => p.id));
                  const total = billing.manpowerCells
                    .filter((c) => c.weekStartIso === w && phaseIds.has(c.phaseId))
                    .reduce((sum, c) => sum + c.hours, 0);
                  const overlap = weekHasPhaseOverlap(
                    billing.manpowerCells.filter((c) => phaseIds.has(c.phaseId)),
                    w,
                  );
                  return (
                    <td
                      key={w}
                      className={`billing-manpower-week-col num billing-manpower-week-total${overlap ? " billing-manpower-week-total--overlap" : ""}`}
                      title={total > 0 ? `${formatManWeeks(total)} man-wk` : undefined}
                    >
                      {formatHours(total)}
                    </td>
                  );
                })}
                <td className="billing-manpower-sticky billing-manpower-total-col" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="muted small billing-manpower-caption">
        {isField
          ? `Tap a cell to edit · clear empties the week · scroll sideways for the full schedule · ${HOURS_PER_MAN_WEEK} hrs = 1 man-week`
          : `Rows sync from Budget Hours PDF · cells = week hours · man-week = ${HOURS_PER_MAN_WEEK} hrs`}
        {canEditCells && !isField ? " · clear a cell with an empty value or right-click" : ""}
        {!canEditSchedule ? " · start/finish set by PM" : ""}
      </p>

      {detailWeek && canEditCells && contractPhases.length > 0 ? (
        <ManpowerWeekDetailModal
          weekStartIso={detailWeek}
          billing={billing}
          phases={contractPhases}
          saving={saving}
          onClose={() => setDetailWeek(null)}
          onSave={saveWeekDetail}
        />
      ) : null}
    </section>
  );
}
