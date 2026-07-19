import { useEffect, useMemo, useState } from "react";
import {
  cellDayHours,
  emptyDayHours,
  formatJobDateLabel,
  HOURS_PER_CREW_DAY,
  weekColumnLabel,
  weekDayColumnLabels,
  withWeekDayHours,
} from "../../lib/manpowerCalendar";
import {
  MANPOWER_PHASE_DEFS,
  PHASE_COLORS,
  type ManpowerPhaseId,
  type ProjectBillingData,
} from "../../types/projectBilling";

type Props = {
  weekStartIso: string;
  billing: ProjectBillingData;
  saving: boolean;
  onClose: () => void;
  onSave: (next: ProjectBillingData) => Promise<boolean>;
};

type DraftByPhase = Record<ManpowerPhaseId, string[]>;

function hoursToCrew(hours: number): number {
  if (hours <= 0) return 0;
  return hours / HOURS_PER_CREW_DAY;
}

function crewToHours(crew: number): number {
  if (crew <= 0) return 0;
  return crew * HOURS_PER_CREW_DAY;
}

function hoursToCrewDraft(hours: number[]): string[] {
  return hours.map((h) => {
    const crew = hoursToCrew(h);
    if (crew <= 0) return "";
    return Number.isInteger(crew) ? String(crew) : String(Number(crew.toFixed(2)));
  });
}

function parseCrew(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function draftToDayHours(draft: string[]): number[] {
  return emptyDayHours().map((_, i) => crewToHours(parseCrew(draft[i] ?? "")));
}

function formatCrew(crew: number): string {
  if (crew <= 0) return "—";
  return Number.isInteger(crew) ? String(crew) : crew.toFixed(1);
}

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function ManpowerWeekDetailModal({ weekStartIso, billing, saving, onClose, onSave }: Props) {
  const dayCols = useMemo(() => weekDayColumnLabels(weekStartIso), [weekStartIso]);
  const weekLabel = weekColumnLabel(weekStartIso);
  const rangeLabel = useMemo(() => {
    const start = formatJobDateLabel(dayCols[0]!.iso);
    const end = formatJobDateLabel(dayCols[6]!.iso);
    if (start && end) return `${start} – ${end}`;
    return `Week of ${weekLabel}`;
  }, [dayCols, weekLabel]);

  const [draft, setDraft] = useState<DraftByPhase>(() => {
    const initial = {} as DraftByPhase;
    for (const def of MANPOWER_PHASE_DEFS) {
      initial[def.id] = hoursToCrewDraft(cellDayHours(billing.manpowerCells, def.id, weekStartIso));
    }
    return initial;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setPhaseDay(phaseId: ManpowerPhaseId, dayIndex: number, value: string) {
    setDraft((prev) => {
      const nextDays = [...(prev[phaseId] ?? hoursToCrewDraft(emptyDayHours()))];
      nextDays[dayIndex] = value;
      return { ...prev, [phaseId]: nextDays };
    });
  }

  const phaseCrewTotals = useMemo(() => {
    const totals = {} as Record<ManpowerPhaseId, number>;
    for (const def of MANPOWER_PHASE_DEFS) {
      totals[def.id] = (draft[def.id] ?? []).reduce((sum, raw) => sum + parseCrew(raw), 0);
    }
    return totals;
  }, [draft]);

  const dayCrewTotals = useMemo(() => {
    return emptyDayHours().map((_, dayIndex) =>
      MANPOWER_PHASE_DEFS.reduce((sum, def) => sum + parseCrew(draft[def.id]?.[dayIndex] ?? ""), 0),
    );
  }, [draft]);

  const grandCrew = dayCrewTotals.reduce((sum, n) => sum + n, 0);
  const grandHours = crewToHours(grandCrew);

  async function handleSave() {
    const byPhase = {} as Record<ManpowerPhaseId, number[]>;
    for (const def of MANPOWER_PHASE_DEFS) {
      byPhase[def.id] = draftToDayHours(draft[def.id] ?? []);
    }
    const nextCells = withWeekDayHours(billing.manpowerCells, weekStartIso, byPhase);
    const next = { ...billing, manpowerCells: nextCells };
    const ok = await onSave(next);
    if (ok) onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack billing-week-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-week-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <div>
            <h2 id="billing-week-detail-title" className="billing-card-title">
              Plan week · {weekLabel}
            </h2>
            <p className="muted small billing-manpower-caption">{rangeLabel}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="muted small billing-manpower-caption">
          Enter crew count per day (1 person = {HOURS_PER_CREW_DAY} hrs). Example: 5 = {5 * HOURS_PER_CREW_DAY}{" "}
          hrs. Week totals on the plan update from these hours.
        </p>

        <div className="billing-week-detail-scroll">
          <table className="billing-week-detail-table">
            <thead>
              <tr>
                <th className="billing-week-detail-phase-col">Phase</th>
                {dayCols.map((col) => (
                  <th key={col.iso} className="billing-week-detail-day-col num">
                    <span className="billing-week-detail-weekday">{col.weekday}</span>
                    <span className="billing-week-detail-date muted">{col.dateLabel}</span>
                  </th>
                ))}
                <th className="billing-week-detail-total-col num">Crew</th>
                <th className="billing-week-detail-total-col num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {MANPOWER_PHASE_DEFS.map((def) => {
                const colors = PHASE_COLORS[def.id];
                const days = draft[def.id] ?? hoursToCrewDraft(emptyDayHours());
                const crewTotal = phaseCrewTotals[def.id];
                return (
                  <tr key={def.id}>
                    <td
                      className="billing-week-detail-phase-col billing-manpower-phase-name"
                      style={{ borderLeftColor: colors.border }}
                    >
                      {def.name}
                    </td>
                    {days.map((value, dayIndex) => (
                      <td key={dayCols[dayIndex]!.iso} className="billing-week-detail-day-col">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="billing-week-detail-input"
                          value={value}
                          placeholder="—"
                          aria-label={`${def.name} ${dayCols[dayIndex]!.weekday} crew`}
                          title={`${parseCrew(value) || 0} crew × ${HOURS_PER_CREW_DAY} = ${crewToHours(parseCrew(value))} hrs`}
                          onChange={(e) => setPhaseDay(def.id, dayIndex, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="billing-week-detail-total-col num">
                      <strong style={{ color: colors.text }}>{formatCrew(crewTotal)}</strong>
                    </td>
                    <td className="billing-week-detail-total-col num">
                      <span className="muted">{formatHours(crewToHours(crewTotal))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="billing-week-detail-total-row">
                <td className="billing-week-detail-phase-col">Day crew</td>
                {dayCrewTotals.map((total, dayIndex) => (
                  <td key={dayCols[dayIndex]!.iso} className="billing-week-detail-day-col num">
                    <div className="billing-week-detail-day-total">
                      <span>{formatCrew(total)}</span>
                      <span className="muted small">{formatHours(crewToHours(total))}</span>
                    </div>
                  </td>
                ))}
                <td className="billing-week-detail-total-col num">
                  <strong>{formatCrew(grandCrew)}</strong>
                </td>
                <td className="billing-week-detail-total-col num">
                  <strong>{formatHours(grandHours)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="row-gap wrap billing-week-detail-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save week"}
          </button>
        </div>
      </div>
    </div>
  );
}
