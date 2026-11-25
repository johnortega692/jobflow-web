import { useEffect, useMemo, useState } from "react";
import { spreadActivityHours, type SpreadActivityHours, type SpreadMode } from "../../lib/spreadBudgetHours";

type Props = {
  activities: SpreadActivityHours[];
  gridStart: string;
  weekCount: number;
  holidays?: readonly string[];
  saving: boolean;
  canUndo: boolean;
  onPreview: (rows: { id: string; hours: number[] }[] | null) => void;
  onApply: (rows: { id: string; hours: number[]; dayHours: number[][] }[]) => void;
  onUndo: () => void;
};

export function SpreadBudgetHours({
  activities,
  gridStart,
  weekCount,
  holidays = [],
  saving,
  canUndo,
  onPreview,
  onApply,
  onUndo,
}: Props) {
  const [mode, setMode] = useState<SpreadMode>("activity-days");
  const [lockedSignature, setLockedSignature] = useState<string | null>(null);

  const result = useMemo(
    () => spreadActivityHours(activities, gridStart, weekCount, mode, holidays),
    [activities, gridStart, holidays, mode, weekCount],
  );

  const signature = `${mode}|${activities
    .map((activity) => `${activity.id}:${activity.phaseId}:${activity.hours}:${activity.budgetHours ?? 0}:${activity.startIso}:${activity.endIso}:${activity.includeWeekends ? "1" : "0"}`)
    .join(",")}|${gridStart}|${weekCount}`;
  const placed = signature === lockedSignature && result.totalHours > 0;
  const previewRows = placed ? null : result.rows;
  const previewKey = previewRows
    ? previewRows.map((row) => `${row.id}:${row.hours.join(",")}`).join("|")
    : "";

  useEffect(() => {
    onPreview(previewRows);
    // previewKey is the hour content. A new row array with the same hours must not update the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPreview, previewKey]);

  useEffect(() => () => onPreview(null), [onPreview]);

  return (
    <section className="spread-budget">
      <fieldset className="spread-budget-weight">
        <legend>Spread checked hours</legend>
        <label>
          <input
            type="radio"
            name="spread-budget-weight"
            checked={mode === "activity-days"}
            disabled={saving}
            onChange={() => setMode("activity-days")}
          />
          By activity days
          <span className="spread-budget-tip" role="tooltip">
            Gives more hours to weeks that have more activity days. A 5-day week gets more than a 1-day week.
          </span>
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
          <span className="spread-budget-tip" role="tooltip">
            Splits the hours evenly across every week the activities touch. A 1-day week gets the same as a full week.
          </span>
        </label>
      </fieldset>

      {result.skippedBeforeGrid.length > 0 ? (
        <p className="spread-budget-skip">Workdays before the grid start on a checked activity were left out.</p>
      ) : null}

      <p className="spread-budget-help">
        Each cost code shows its total hours on the grid. Give some of that total to the GC activities on that code, then Place on weeks. Those hours land on the weeks the activity covers, filling 8-hour days first. Leave Hours blank to use the whole total. Hidden cost codes are left out. Spread again puts the same spread back after the weeks are cleared.
      </p>

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
          disabled={saving || result.totalHours <= 0 || (!previewRows && !placed)}
          onClick={() => {
            setLockedSignature(signature);
            onApply(result.rows.filter((row) => row.hours.some((hours) => hours > 0)));
          }}
        >
          {placed ? "Spread again" : "Place on weeks"}
        </button>
      </div>
    </section>
  );
}
