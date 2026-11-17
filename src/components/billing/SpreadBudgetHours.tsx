import { useEffect, useMemo, useState } from "react";
import {
  plannedHoursForPhase,
  phaseDisplayLabel,
  type GcScheduleSavedItem,
  type ManpowerCell,
  type ManpowerPhase,
} from "../../types/projectBilling";
import { spreadBudgetHours, type SpreadMode } from "../../lib/spreadBudgetHours";

type Props = {
  phases: ManpowerPhase[];
  activities: GcScheduleSavedItem[];
  cells: ManpowerCell[];
  gridStart: string;
  weekCount: number;
  saving: boolean;
  canUndo: boolean;
  onPreview: (rows: { id: string; hours: number[] }[] | null) => void;
  onApply: (rows: { id: string; hours: number[] }[]) => void;
  onUndo: () => void;
};

function wholeHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function remainingHours(phase: ManpowerPhase, cells: ManpowerCell[]): number {
  return wholeHours(phase.budgetHours - plannedHoursForPhase(phase.id, cells));
}

function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])}`;
}

function dateRange(startIso: string, finishIso: string): string {
  const start = shortDate(startIso);
  const finish = shortDate(finishIso);
  if (start && finish && start !== finish) return `${start} – ${finish}`;
  return start || finish || "No dates";
}

export function SpreadBudgetHours({
  phases,
  activities,
  cells,
  gridStart,
  weekCount,
  saving,
  canUndo,
  onPreview,
  onApply,
  onUndo,
}: Props) {
  const budgetPhases = useMemo(() => phases.filter((phase) => phase.budgetHours > 0), [phases]);
  const [excludedCodes, setExcludedCodes] = useState<Set<string>>(() => new Set());
  const [hourText, setHourText] = useState<Record<string, string>>({});
  const [excludedActivities, setExcludedActivities] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<SpreadMode>("activity-days");
  const [lockedSignature, setLockedSignature] = useState<string | null>(null);

  useEffect(() => {
    setHourText((current) => {
      let changed = false;
      const next = { ...current };
      for (const phase of budgetPhases) {
        if (next[phase.id] !== undefined) continue;
        next[phase.id] = String(remainingHours(phase, cells));
        changed = true;
      }
      return changed ? next : current;
    });
  }, [budgetPhases, cells]);

  const budgets = useMemo(
    () =>
      budgetPhases
        .filter((phase) => !excludedCodes.has(phase.id))
        .map((phase) => {
          const typed = hourText[phase.id];
          const hours = typed === undefined ? remainingHours(phase, cells) : wholeHours(Number(typed));
          return { id: phase.id, hours };
        })
        .filter((budget) => budget.hours > 0),
    [budgetPhases, cells, excludedCodes, hourText],
  );

  const includedActivities = useMemo(
    () =>
      activities
        .filter((activity) => activity.name.trim() && !excludedActivities.has(activity.id))
        .map((activity) => ({
          id: activity.id,
          startIso: activity.startIso,
          endIso: activity.finishIso || activity.startIso,
        })),
    [activities, excludedActivities],
  );

  const result = useMemo(
    () => spreadBudgetHours(includedActivities, budgets, gridStart, weekCount, mode),
    [budgets, gridStart, includedActivities, mode, weekCount],
  );

  const signature = `${mode}|${budgets.map((budget) => `${budget.id}:${budget.hours}`).join(",")}|${includedActivities
    .map((activity) => `${activity.id}:${activity.startIso}:${activity.endIso}`)
    .join(",")}|${gridStart}|${weekCount}`;
  const previewRows = signature === lockedSignature ? null : result.rows;

  useEffect(() => {
    onPreview(previewRows);
  }, [onPreview, previewRows]);

  useEffect(() => () => onPreview(null), [onPreview]);

  const skippedById = useMemo(
    () => new Map(result.skippedBeforeGrid.map((row) => [row.id, row.days])),
    [result.skippedBeforeGrid],
  );

  function codeLabel(phase: ManpowerPhase): string {
    if (phase.costCode && phase.name && phase.name !== phase.costCode) return `${phase.costCode} ${phase.name}`;
    return phaseDisplayLabel(phase);
  }

  return (
    <section className="spread-budget">
      <h3 className="spread-budget-title">Spread budget hours</h3>
      <div className="spread-budget-block">
        <h4>Hours to spread</h4>
        {budgetPhases.length === 0 ? (
          <p className="muted small">No cost codes on this contract have budget hours.</p>
        ) : (
          <ul className="spread-budget-list">
            {budgetPhases.map((phase) => {
              const checked = !excludedCodes.has(phase.id);
              const value = hourText[phase.id] ?? String(remainingHours(phase, cells));
              return (
                <li key={phase.id} className="spread-budget-code">
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={(event) => {
                        const on = event.target.checked;
                        setExcludedCodes((current) => {
                          const next = new Set(current);
                          if (on) next.delete(phase.id);
                          else next.add(phase.id);
                          return next;
                        });
                      }}
                    />
                    {codeLabel(phase)}
                  </label>
                  <input
                    className="spread-budget-hours"
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Hours to spread for ${codeLabel(phase)}`}
                    value={value}
                    disabled={saving || !checked}
                    onChange={(event) => setHourText((current) => ({ ...current, [phase.id]: event.target.value }))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="spread-budget-block">
        <h4>Across these GC activities</h4>
        {activities.length === 0 ? (
          <p className="muted small">Add GC activities before spreading hours.</p>
        ) : (
          <ul className="spread-budget-list">
            {activities.map((activity) => {
              const checked = !excludedActivities.has(activity.id);
              const skipped = skippedById.get(activity.id) ?? 0;
              const label = activity.name.trim() || "Untitled activity";
              return (
                <li key={activity.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={(event) => {
                        const on = event.target.checked;
                        setExcludedActivities((current) => {
                          const next = new Set(current);
                          if (on) next.delete(activity.id);
                          else next.add(activity.id);
                          return next;
                        });
                      }}
                    />
                    <span>{label}</span>
                    <span className="muted">{dateRange(activity.startIso, activity.finishIso)}</span>
                  </label>
                  {checked && skipped > 0 ? (
                    <p className="spread-budget-skip">
                      {skipped} workday{skipped === 1 ? "" : "s"} before the grid start {skipped === 1 ? "was" : "were"} left out.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <fieldset className="spread-budget-weight">
        <legend>Weight</legend>
        <label>
          <input
            type="radio"
            name="spread-budget-weight"
            checked={mode === "activity-days"}
            disabled={saving}
            onChange={() => setMode("activity-days")}
          />
          By activity days
        </label>
        <label>
          <input
            type="radio"
            name="spread-budget-weight"
            checked={mode === "even-per-week"}
            disabled={saving}
            onChange={() => setMode("even-per-week")}
          />
          Even per week
        </label>
      </fieldset>

      <div className="spread-budget-footer">
        <span>
          {result.totalHours} hrs over {result.activeWeekCount} week{result.activeWeekCount === 1 ? "" : "s"}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!canUndo || saving} onClick={onUndo}>
          Undo
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving || !previewRows || result.totalHours <= 0}
          onClick={() => {
            setLockedSignature(signature);
            onApply(result.rows.filter((row) => row.hours.some((hours) => hours > 0)));
          }}
        >
          Apply to grid
        </button>
      </div>
    </section>
  );
}
