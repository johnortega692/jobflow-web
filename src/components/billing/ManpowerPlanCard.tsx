import { useCallback, useEffect, useRef, useState } from "react";
import {
  cellHours,
  formatJobDateLabel,
  hoursToManWeeks,
  manpowerEndDateHint,
  manpowerWeekStarts,
  phaseTotalHours,
  weekColumnLabel,
  weekHasPhaseOverlap,
  weekTotalHours,
  withCellHours,
} from "../../lib/manpowerCalendar";
import {
  HOURS_PER_MAN_WEEK,
  MANPOWER_PHASE_DEFS,
  PHASE_COLORS,
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
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
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

export function ManpowerPlanCard({
  billing,
  projectStartIso,
  projectEndIso,
  saving,
  onBillingChange,
  onPersistQuiet,
}: Props) {
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitHours = useCallback(
    async (phaseId: ManpowerPhaseId, weekStartIso: string, raw: string) => {
      const n = raw.trim() === "" ? 0 : Number(raw);
      const hours = Number.isFinite(n) && n >= 0 ? n : 0;
      // Flat week edit clears any day breakdown for this phase/week.
      const nextCells = withCellHours(billing.manpowerCells, phaseId, weekStartIso, hours);
      const next = { ...billing, manpowerCells: nextCells };
      onBillingChange(next);
      setEditing(null);
      await onPersistQuiet(next);
    },
    [billing, onBillingChange, onPersistQuiet],
  );

  const saveWeekDetail = useCallback(
    async (next: ProjectBillingData) => {
      onBillingChange(next);
      return onPersistQuiet(next);
    },
    [onBillingChange, onPersistQuiet],
  );

  async function addWeek() {
    const next = { ...billing, manpowerWeekCount: billing.manpowerWeekCount + 1 };
    onBillingChange(next);
    await onPersistQuiet(next);
  }

  return (
    <section className="card stack billing-card billing-manpower-card">
      <div className="row-between wrap gap">
        <h3 className="billing-card-title">Manpower plan</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addWeek()} disabled={saving}>
          Add week
        </button>
      </div>

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : endDateLabel && contractEndWeekIndex !== null ? (
        <p className="muted small billing-manpower-end-hint">
          Contract schedule through {endDateLabel} ({weeks.length} weeks) · scroll horizontally for all columns
        </p>
      ) : null}

      <div className="billing-manpower-scroll" tabIndex={0} aria-label="Manpower plan weeks — scroll horizontally">
        <table className="billing-manpower-table">
          <thead>
            <tr>
              <th className="billing-manpower-sticky billing-manpower-phase-col">Phase</th>
              {weeks.map((w, weekIdx) => (
                <th
                  key={w}
                  className={`billing-manpower-week-col num${
                    contractEndWeekIndex !== null && weekIdx > contractEndWeekIndex
                      ? " billing-manpower-week-col--beyond-contract"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="billing-manpower-header-pill"
                    onClick={() => setDetailWeek(w)}
                    title={`Plan daily hours for week of ${weekColumnLabel(w)}`}
                  >
                    <ManpowerHeaderPencilIcon />
                    {weekColumnLabel(w)}
                  </button>
                </th>
              ))}
              <th className="billing-manpower-sticky billing-manpower-total-col num">Man-wks</th>
              <th className="billing-manpower-sticky billing-manpower-total-col num">Hours</th>
            </tr>
          </thead>
          <tbody>
            {MANPOWER_PHASE_DEFS.map((def) => {
              const colors = PHASE_COLORS[def.id];
              const phaseHours = phaseTotalHours(billing.manpowerCells, def.id);
              return (
                <tr key={def.id}>
                  <td
                    className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-phase-name"
                    style={{ borderLeftColor: colors.border }}
                  >
                    {def.name}
                  </td>
                  {weeks.map((w) => {
                    const hrs = cellHours(billing.manpowerCells, def.id, w);
                    const key = cellKey(def.id, w);
                    const isEditing = editing === key;
                    return (
                      <td key={w} className="billing-manpower-week-col">
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="number"
                            min={0}
                            step={0.5}
                            className="billing-manpower-cell-input"
                            value={draftHours}
                            onChange={(e) => setDraftHours(e.target.value)}
                            onBlur={() => void commitHours(def.id, w, draftHours)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitHours(def.id, w, draftHours);
                              if (e.key === "Escape") setEditing(null);
                            }}
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
                            onClick={() => {
                              setEditing(key);
                              setDraftHours(hrs > 0 ? String(hrs) : "");
                            }}
                            title={hrs > 0 ? `${formatHours(hrs)} hrs · ${formatManWeeks(hrs)} man-wk` : "Add hours"}
                            aria-label={`${def.name} week ${weekColumnLabel(w)} hours`}
                          >
                            {hrs > 0 ? formatHours(hrs) : "—"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="billing-manpower-sticky billing-manpower-total-col num">
                    {formatManWeeks(phaseHours)}
                  </td>
                  <td className="billing-manpower-sticky billing-manpower-total-col num">
                    {formatHours(phaseHours)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="billing-manpower-total-row">
              <td className="billing-manpower-sticky billing-manpower-phase-col">Total hrs</td>
              {weeks.map((w) => {
                const total = weekTotalHours(billing.manpowerCells, w);
                const overlap = weekHasPhaseOverlap(billing.manpowerCells, w);
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

      <div className="billing-manpower-legend">
        {MANPOWER_PHASE_DEFS.map((def) => {
          const colors = PHASE_COLORS[def.id];
          return (
            <span key={def.id} className="billing-manpower-legend-item">
              <span className="billing-manpower-legend-swatch" style={{ background: colors.border }} />
              {def.name}
            </span>
          );
        })}
      </div>
      <p className="muted small billing-manpower-caption">
        cells = week hours · man-week = {HOURS_PER_MAN_WEEK} hrs
      </p>

      {detailWeek ? (
        <ManpowerWeekDetailModal
          weekStartIso={detailWeek}
          billing={billing}
          saving={saving}
          onClose={() => setDetailWeek(null)}
          onSave={saveWeekDetail}
        />
      ) : null}
    </section>
  );
}
