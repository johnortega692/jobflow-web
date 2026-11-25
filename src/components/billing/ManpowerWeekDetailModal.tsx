import { useEffect, useMemo, useRef, useState } from "react";
import {
  cellDayHours,
  emptyDayHours,
  formatJobDateLabel,
  HOURS_PER_CREW_DAY,
  weekColumnLabel,
  weekDayColumnLabels,
  withCellDayHours,
} from "../../lib/manpowerCalendar";
import {
  phaseColorAtIndex,
  phaseDisplayLabel,
  type ManpowerPhase,
  type ManpowerPhaseId,
  type ProjectBillingData,
} from "../../types/projectBilling";

type Props = {
  weekStartIso: string;
  billing: ProjectBillingData;
  phases: ManpowerPhase[];
  saving: boolean;
  onClose: () => void;
  onSave: (next: ProjectBillingData) => Promise<boolean>;
};

type DraftByPhase = Record<string, string[]>;

type DayBlock = "holiday" | "rain" | "delay";

const DAY_BLOCKS: { kind: DayBlock; label: string }[] = [
  { kind: "holiday", label: "Holiday" },
  { kind: "rain", label: "Rain" },
  { kind: "delay", label: "Delay" },
];

function savedBlocks(billing: ProjectBillingData, weekStartIso: string): Map<string, DayBlock> {
  const holiday = new Set(billing.holidays ?? []);
  const rain = new Set(billing.rainDays ?? []);
  const delay = new Set(billing.delayDays ?? []);
  const blocks = new Map<string, DayBlock>();
  for (const col of weekDayColumnLabels(weekStartIso)) {
    if (holiday.has(col.iso)) blocks.set(col.iso, "holiday");
    else if (rain.has(col.iso)) blocks.set(col.iso, "rain");
    else if (delay.has(col.iso)) blocks.set(col.iso, "delay");
  }
  return blocks;
}

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

export function ManpowerWeekDetailModal({
  weekStartIso,
  billing,
  phases,
  saving,
  onClose,
  onSave,
}: Props) {
  const dayCols = useMemo(() => weekDayColumnLabels(weekStartIso), [weekStartIso]);
  const weekLabel = weekColumnLabel(weekStartIso);
  const rangeLabel = useMemo(() => {
    const start = formatJobDateLabel(dayCols[0]!.iso);
    const end = formatJobDateLabel(dayCols[6]!.iso);
    if (start && end) return `${start} – ${end}`;
    return `Week of ${weekLabel}`;
  }, [dayCols, weekLabel]);

  const phaseIndexById = useMemo(() => {
    const map = new Map<string, number>();
    billing.manpowerPhases.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [billing.manpowerPhases]);

  const heldDays = useRef<Record<number, Record<string, string>>>({});
  const [draft, setDraft] = useState<DraftByPhase>(() => {
    const cols = weekDayColumnLabels(weekStartIso);
    const saved = savedBlocks(billing, weekStartIso);
    const initial: DraftByPhase = {};
    const held: Record<number, Record<string, string>> = {};
    for (const phase of phases) {
      const crew = hoursToCrewDraft(cellDayHours(billing.manpowerCells, phase.id, weekStartIso));
      cols.forEach((col, index) => {
        if (!saved.has(col.iso)) return;
        held[index] = held[index] ?? {};
        held[index][phase.id] = crew[index] ?? "";
        crew[index] = "";
      });
      initial[phase.id] = crew;
    }
    heldDays.current = held;
    return initial;
  });
  const [blocked, setBlocked] = useState<Map<string, DayBlock>>(() => savedBlocks(billing, weekStartIso));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setPhaseDay(phaseId: ManpowerPhaseId, dayIndex: number, value: string) {
    if (blocked.has(dayCols[dayIndex]?.iso ?? "")) return;
    setDraft((prev) => {
      const nextDays = [...(prev[phaseId] ?? hoursToCrewDraft(emptyDayHours()))];
      nextDays[dayIndex] = value;
      return { ...prev, [phaseId]: nextDays };
    });
  }

  function setBlock(dayIndex: number, kind: DayBlock | null) {
    const iso = dayCols[dayIndex]?.iso;
    if (!iso) return;
    const current = blocked.get(iso) ?? null;
    if (current === kind) return;
    setBlocked((prev) => {
      const next = new Map(prev);
      if (kind) next.set(iso, kind);
      else next.delete(iso);
      return next;
    });
    if (kind && current) return;
    setDraft((prev) => {
      const next = { ...prev };
      if (kind) {
        const stash: Record<string, string> = {};
        for (const phase of phases) {
          const days = [...(next[phase.id] ?? hoursToCrewDraft(emptyDayHours()))];
          stash[phase.id] = days[dayIndex] ?? "";
          days[dayIndex] = "";
          next[phase.id] = days;
        }
        heldDays.current[dayIndex] = stash;
        return next;
      }
      const stash = heldDays.current[dayIndex];
      if (!stash) return prev;
      for (const phase of phases) {
        const days = [...(next[phase.id] ?? hoursToCrewDraft(emptyDayHours()))];
        days[dayIndex] = stash[phase.id] ?? "";
        next[phase.id] = days;
      }
      return next;
    });
  }

  const phaseCrewTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const phase of phases) {
      totals[phase.id] = (draft[phase.id] ?? []).reduce((sum, raw) => sum + parseCrew(raw), 0);
    }
    return totals;
  }, [draft, phases]);

  const dayCrewTotals = useMemo(() => {
    return emptyDayHours().map((_, dayIndex) =>
      phases.reduce((sum, phase) => sum + parseCrew(draft[phase.id]?.[dayIndex] ?? ""), 0),
    );
  }, [draft, phases]);

  const grandCrew = dayCrewTotals.reduce((sum, n) => sum + n, 0);
  const grandHours = crewToHours(grandCrew);

  async function handleSave() {
    const activeIds = new Set(phases.map((p) => p.id));
    const blockedIndexes = dayCols.flatMap((col, index) => (blocked.has(col.iso) ? [index] : []));
    let nextCells = billing.manpowerCells.filter(
      (c) => !(c.weekStartIso === weekStartIso && activeIds.has(c.phaseId)),
    );
    for (const phase of phases) {
      const hours = draftToDayHours(draft[phase.id] ?? []);
      for (const index of blockedIndexes) hours[index] = 0;
      nextCells = withCellDayHours(nextCells, phase.id, weekStartIso, hours);
    }
    nextCells = nextCells.flatMap((cell) => {
      if (cell.weekStartIso !== weekStartIso || !cell.dayHours || blockedIndexes.length === 0) return [cell];
      let changed = false;
      const dayHours = cell.dayHours.map((hours, index) => {
        if (!blockedIndexes.includes(index) || hours <= 0) return hours;
        changed = true;
        return 0;
      });
      if (!changed) return [cell];
      const hours = dayHours.reduce((sum, value) => sum + value, 0);
      if (hours <= 0) return [];
      return [{ ...cell, hours, dayHours }];
    });
    const weekIsos = new Set(dayCols.map((col) => col.iso));
    const datesFor = (kind: DayBlock, existing: string[]) =>
      [
        ...existing.filter((iso) => !weekIsos.has(iso)),
        ...dayCols.map((col) => col.iso).filter((iso) => blocked.get(iso) === kind),
      ].sort();
    const next = {
      ...billing,
      manpowerCells: nextCells,
      holidays: datesFor("holiday", billing.holidays ?? []),
      rainDays: datesFor("rain", billing.rainDays ?? []),
      delayDays: datesFor("delay", billing.delayDays ?? []),
    };
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
          Enter crew count per day (1 person = {HOURS_PER_CREW_DAY} hrs). Use the day menu for a holiday,
          rain day, or delay. Those days stay off the crew count.
        </p>

        <div className="billing-week-detail-scroll">
          <table className="billing-week-detail-table">
            <thead>
              <tr>
                <th className="billing-week-detail-phase-col">Cost code</th>
                {dayCols.map((col, dayIndex) => {
                  const kind = blocked.get(col.iso) ?? null;
                  return (
                    <th key={col.iso} className={`billing-week-detail-day-col num${kind ? ` is-${kind}` : ""}`}>
                      <span className="billing-week-detail-weekday">{col.weekday}</span>
                      <span className="billing-week-detail-date muted">{col.dateLabel}</span>
                      <select
                        className={`billing-week-detail-mark-select${kind ? ` is-${kind}` : ""}`}
                        aria-label={`${col.weekday} ${col.dateLabel} day mark`}
                        value={kind ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setBlock(dayIndex, next === "holiday" || next === "rain" || next === "delay" ? next : null);
                        }}
                      >
                        <option value="">Work</option>
                        {DAY_BLOCKS.map((block) => (
                          <option key={block.kind} value={block.kind}>
                            {block.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  );
                })}
                <th className="billing-week-detail-total-col num">Crew</th>
                <th className="billing-week-detail-total-col num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((phase) => {
                const colors = phaseColorAtIndex(phaseIndexById.get(phase.id) ?? 0);
                const days = draft[phase.id] ?? hoursToCrewDraft(emptyDayHours());
                const crewTotal = phaseCrewTotals[phase.id] ?? 0;
                return (
                  <tr key={phase.id}>
                    <td
                      className="billing-week-detail-phase-col billing-manpower-phase-name"
                      style={{ borderLeftColor: colors.border }}
                    >
                      <span className="billing-manpower-phase-code">{phase.costCode || "—"}</span>
                      <span className="billing-manpower-phase-desc">{phase.name}</span>
                    </td>
                    {days.map((value, dayIndex) => {
                      const kind = blocked.get(dayCols[dayIndex]!.iso) ?? null;
                      const block = DAY_BLOCKS.find((item) => item.kind === kind);
                      return (
                        <td
                          key={dayCols[dayIndex]!.iso}
                          className={`billing-week-detail-day-col${kind ? ` is-${kind}` : ""}`}
                        >
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="billing-week-detail-input"
                            value={kind ? "" : value}
                            placeholder="—"
                            disabled={Boolean(kind)}
                            aria-label={`${phaseDisplayLabel(phase)} ${dayCols[dayIndex]!.weekday} crew`}
                            title={
                              block
                                ? block.label
                                : `${parseCrew(value) || 0} crew × ${HOURS_PER_CREW_DAY} = ${crewToHours(parseCrew(value))} hrs`
                            }
                            onChange={(e) => setPhaseDay(phase.id, dayIndex, e.target.value)}
                          />
                        </td>
                      );
                    })}
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
                {dayCrewTotals.map((total, dayIndex) => {
                  const kind = blocked.get(dayCols[dayIndex]!.iso) ?? null;
                  const block = DAY_BLOCKS.find((item) => item.kind === kind);
                  return (
                    <td
                      key={dayCols[dayIndex]!.iso}
                      className={`billing-week-detail-day-col num${kind ? ` is-${kind}` : ""}`}
                    >
                      <div className="billing-week-detail-day-total">
                        {block ? (
                          <span className={`billing-week-detail-holiday-tag is-${block.kind}`}>{block.label}</span>
                        ) : (
                          <>
                            <span>{formatCrew(total)}</span>
                            <span className="muted small">{formatHours(crewToHours(total))}</span>
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
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
