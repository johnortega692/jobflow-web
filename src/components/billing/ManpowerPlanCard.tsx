import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DateInput } from "../DateInput";
import {
  cellHours,
  addWeeksIso,
  DEFAULT_MANPOWER_WEEK_COUNT,
  mondayIsoFromDateInput,
  shiftIsoDate,
  weekIndex,
  formatJobDateLabel,
  hoursToManWeeks,
  manpowerEndDateHint,
  manpowerWeekStarts,
  phaseTotalHours,
  todayMondayIso,
  weekColumnLabel,
  weekDayIsos,
  weekHasPhaseOverlap,
  sumDayHours,
  withCellDayHours,
  withCellHours,
} from "../../lib/manpowerCalendar";
import { carryOver, type CarryDest } from "../../lib/carryOver";
import { weekActivityWeights } from "../../lib/spreadBudgetHours";
import {
  blendedCostRate,
  formatMoney0,
  monthPocBillable,
} from "../../lib/manpowerCalculator";
import { currentMonthKey, currentMonthLabel, deriveMonthlyHours } from "../../lib/manpowerHours";
import {
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../../lib/jobInfo";
import {
  HOURS_PER_MAN_WEEK,
  phaseColorAtIndex,
  phaseDisplayLabel,
  plannedHoursForPhase,
  type GcScheduleSavedItem,
  type ManpowerCell,
  type ManpowerPhase,
  type ManpowerPhaseId,
  type ProjectBillingData,
} from "../../types/projectBilling";
import { weeklyHoursPdfFilename } from "../../lib/pdfFilenames";
import { downloadPdfBytes } from "../../lib/pdfDownload";
import type { WeeklyPrintLayout, WeeklyPrintMeasure } from "../../lib/weeklyHoursPrint";
import { GcScheduleImport } from "./GcScheduleImport";
import { GcSchedulePanel } from "./GcSchedulePanel";
import { ManpowerHeaderPencilIcon } from "./ManpowerHeaderPillIcons";
import { ManpowerWeekDetailModal } from "./ManpowerWeekDetailModal";
import { CarryWeekSheet } from "./CarryWeekSheet";
import { addDaysIso, rentalDayFill, rentalQuoteForLine, rentalWeekFill, shiftRentalLine } from "../../lib/rentalEquipment";
import { RentalEquipmentSection, RentalShiftDialog } from "./RentalEquipmentSection";
import { WeeklyHoursPrintDialog } from "./WeeklyHoursPrintDialog";

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
  activeContract?: TransmittalContract;
  contractValues?: Partial<Record<TransmittalContract, number>>;
  onActiveContractChange?: (contract: TransmittalContract) => void;
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
  onScheduleDatesChange?: (startIso: string, endIso: string) => Promise<boolean>;
  projectId?: string;
  jobNumber?: string;
  jobName?: string;
  /** Office monthly billing table. Hidden on the field variant. */
  monthlyBilling?: ReactNode;
};

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

function GcFileIcon() {
  return (
    <svg className="billing-manpower-gc-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M14 3.5V9h5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function formatHoursPlain(hours: number): string {
  if (!Number.isFinite(hours) || hours === 0) return "0";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function shortScheduleDate(iso: string): string {
  const label = formatJobDateLabel(iso);
  if (!label) return "—";
  const parts = label.split("/");
  if (parts.length !== 3 || !parts[2]) return label;
  return `${parts[0]}/${parts[1]}/${parts[2].slice(-2)}`;
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
  activeContract: activeContractProp,
  contractValues,
  onActiveContractChange,
  onBillingChange,
  onPersistQuiet,
  onScheduleDatesChange,
  projectId = "",
  jobNumber = "",
  jobName = "",
  monthlyBilling,
}: Props) {
  const contracts = useMemo<TransmittalContract[]>(() => {
    if (contractsProp?.length) return contractsProp;
    const fromPhases = [...new Set(billing.manpowerPhases.map((p) => p.contract))];
    return fromPhases.length ? fromPhases : ["paint"];
  }, [billing.manpowerPhases, contractsProp]);

  const [internalContract, setInternalContract] = useState<TransmittalContract>(
    () => activeContractProp ?? contracts[0] ?? "paint",
  );
  const activeContract = activeContractProp ?? internalContract;

  function setActiveContract(next: TransmittalContract) {
    if (activeContractProp === undefined) setInternalContract(next);
    onActiveContractChange?.(next);
  }

  useEffect(() => {
    if (!contracts.includes(activeContract)) {
      setActiveContract(contracts[0] ?? "paint");
    }
  }, [activeContract, contracts]);

  useEffect(() => {
    if (activeContractProp !== undefined) setInternalContract(activeContractProp);
  }, [activeContractProp]);

  const contractPhases = useMemo(
    () => billing.manpowerPhases.filter((p) => p.contract === activeContract),
    [activeContract, billing.manpowerPhases],
  );
  const visiblePhases = useMemo(
    () => contractPhases.filter((phase) => phase.hidden !== true),
    [contractPhases],
  );
  const hiddenPhases = useMemo(
    () => contractPhases.filter((phase) => phase.hidden === true),
    [contractPhases],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [phaseColPx, setPhaseColPx] = useState(0);
  const [gcOpen, setGcOpen] = useState(false);
  const [gcMenu, setGcMenu] = useState(false);
  const [importLaunch, setImportLaunch] = useState(0);
  const [datesOpen, setDatesOpen] = useState(false);
  const [planView, setPlanView] = useState<"weekly" | "monthly">("weekly");

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const cell = root.querySelector<HTMLElement>("tbody .billing-manpower-phase-col");
    if (!cell) {
      setPhaseColPx((current) => (current === 0 ? current : 0));
      return;
    }
    const sync = () => {
      const next = Math.ceil(cell.getBoundingClientRect().width);
      setPhaseColPx((current) => (current === next ? current : next));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(cell);
    return () => ro.disconnect();
  }, [activeContract, contractPhases, gcOpen, planView]);

  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const [detailWeek, setDetailWeek] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [rentalShift, setRentalShift] = useState<{ dayDelta: number } | null>(null);
  const [rentalShiftIds, setRentalShiftIds] = useState<string[]>([]);
  const [weekMenu, setWeekMenu] = useState<{ week: string; top: number; left: number } | null>(null);
  const [carryWeek, setCarryWeek] = useState<string | null>(null);
  const [carryToast, setCarryToast] = useState<{
    message: string;
    cells: ManpowerCell[];
    weekCount?: number;
    endIso?: string;
  } | null>(null);
  const [draftStart, setDraftStart] = useState(projectStartIso);
  const [draftEnd, setDraftEnd] = useState(projectEndIso);
  const dragRef = useRef<{
    phaseId: ManpowerPhaseId;
    anchorWeek: string;
    currentWeek: string;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const [dragFill, setDragFill] = useState<{ phaseId: string; anchorWeek: string; currentWeek: string } | null>(null);
  const spreadUndoRef = useRef<{ phaseIds: string[]; cells: ManpowerCell[] } | null>(null);
  const [spreadCanUndo, setSpreadCanUndo] = useState(false);
  const [spreadPreview, setSpreadPreview] = useState<Record<string, number[]> | null>(null);

  useEffect(() => {
    setDraftStart(projectStartIso);
    setDraftEnd(projectEndIso);
  }, [projectStartIso, projectEndIso]);

  const moveDraggedHours = useCallback(
    async (phaseId: ManpowerPhaseId, anchorWeek: string, endWeek: string) => {
      setDragFill(null);
      if (!canEditCells || anchorWeek === endWeek || !weeks.includes(endWeek)) return;
      const source = billing.manpowerCells.find(
        (cell) => cell.phaseId === phaseId && cell.weekStartIso === anchorWeek && cell.hours > 0,
      );
      if (!source) return;
      const destination = billing.manpowerCells.find(
        (cell) => cell.phaseId === phaseId && cell.weekStartIso === endWeek,
      );
      const rest = billing.manpowerCells.filter(
        (cell) =>
          !(cell.phaseId === phaseId && (cell.weekStartIso === anchorWeek || cell.weekStartIso === endWeek)),
      );
      if (!destination) {
        rest.push({ ...source, weekStartIso: endWeek });
      } else {
        const dayHours =
          destination.dayHours && source.dayHours
            ? destination.dayHours.map((hours, index) => hours + (source.dayHours?.[index] ?? 0))
            : undefined;
        rest.push({
          phaseId,
          weekStartIso: endWeek,
          hours: destination.hours + source.hours,
          ...(dayHours ? { dayHours } : {}),
        });
      }
      const next = { ...billing, manpowerCells: rest };
      onBillingChange(next);
      await onPersistQuiet(next);
      const lines = billing.rentalEquipment ?? [];
      const dayDelta = weekIndex(anchorWeek, endWeek) * 7;
      const movable =
        lines.some((line) => line.onRentIso || line.offRentIso) || (billing.rentalEquipmentCells ?? []).length > 0;
      if (dayDelta && movable) {
        setRentalShift({ dayDelta });
        setRentalShiftIds(lines.filter((line) => line.status === "needed").map((line) => line.id));
      }
    },
    [billing, canEditCells, onBillingChange, onPersistQuiet, weeks],
  );

  function weekUnderPointer(clientX: number, clientY: number, phaseId: string): string | null {
    const hit = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-manpower-week]");
    if (!hit || hit.dataset.manpowerPhase !== phaseId) return null;
    return hit.dataset.manpowerWeek ?? null;
  }

  function dragMarks(phaseId: string, week: string): boolean {
    if (!dragFill || dragFill.phaseId !== phaseId) return false;
    return week === dragFill.anchorWeek || week === dragFill.currentWeek;
  }

  const saveWeekDetail = useCallback(
    async (next: ProjectBillingData) => {
      if (!canEditCells) return false;
      onBillingChange(next);
      return onPersistQuiet(next);
    },
    [canEditCells, onBillingChange, onPersistQuiet],
  );

  const showSpreadPreview = useCallback((rows: { id: string; hours: number[] }[] | null) => {
    setSpreadPreview((current) => {
      if (!rows) return current === null ? current : null;
      const next: Record<string, number[]> = {};
      for (const row of rows) next[row.id] = row.hours;
      if (!current) return next;
      const keys = Object.keys(next);
      if (Object.keys(current).length !== keys.length) return next;
      const same = keys.every((key) => {
        const left = current[key];
        const right = next[key];
        return !!left && !!right && left.length === right.length && left.every((hours, index) => hours === right[index]);
      });
      return same ? current : next;
    });
  }, []);

  const applySpread = useCallback(
    async (rows: { id: string; hours: number[]; dayHours: number[][] }[], savedItems?: GcScheduleSavedItem[]) => {
      if (!canEditCells || rows.length === 0) return;
      const phaseIds = new Set(rows.map((row) => row.id));
      const snapshot = billing.manpowerCells
        .filter((cell) => phaseIds.has(cell.phaseId))
        .map((cell) => ({ ...cell, dayHours: cell.dayHours?.slice() }));
      let cells = billing.manpowerCells;
      for (const row of rows) {
        weeks.forEach((week, index) => {
          const weekHours = row.hours[index] ?? 0;
          const days = row.dayHours[index];
          if (days && weekHours > 0 && sumDayHours(days) === weekHours) {
            cells = withCellDayHours(cells, row.id, week, days);
          } else {
            cells = withCellHours(cells, row.id, week, weekHours);
          }
        });
      }
      spreadUndoRef.current = { phaseIds: [...phaseIds], cells: snapshot };
      setSpreadCanUndo(true);
      setSpreadPreview(null);
      const next = {
        ...billing,
        ...(savedItems
          ? {
              gcSchedule: {
                fileName: billing.gcSchedule?.fileName ?? "",
                importedAt: billing.gcSchedule?.importedAt || new Date().toISOString(),
                items: savedItems,
              },
            }
          : {}),
        manpowerCells: cells,
      };
      onBillingChange(next);
      await onPersistQuiet(next);
    },
    [billing, canEditCells, onBillingChange, onPersistQuiet, weeks],
  );

  const undoSpread = useCallback(async () => {
    const undo = spreadUndoRef.current;
    if (!canEditCells || !undo) return;
    const phaseIds = new Set(undo.phaseIds);
    const cells = [
      ...billing.manpowerCells.filter((cell) => !phaseIds.has(cell.phaseId)),
      ...undo.cells.map((cell) => ({ ...cell, dayHours: cell.dayHours?.slice() })),
    ];
    spreadUndoRef.current = null;
    setSpreadCanUndo(false);
    setSpreadPreview(null);
    const next = { ...billing, manpowerCells: cells };
    onBillingChange(next);
    await onPersistQuiet(next);
  }, [billing, canEditCells, onBillingChange, onPersistQuiet]);

  useEffect(() => {
    if (!gcMenu) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-gc-menu]")) return;
      setGcMenu(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setGcMenu(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [gcMenu]);

  useEffect(() => {
    if (!weekMenu) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-week-menu]")) return;
      setWeekMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setWeekMenu(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    const root = scrollRef.current;
    const close = () => setWeekMenu(null);
    root?.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      root?.removeEventListener("scroll", close);
    };
  }, [weekMenu]);

  useEffect(() => {
    if (!carryToast) return;
    const timer = window.setTimeout(() => setCarryToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [carryToast]);

  const applyCarry = useCallback(
    async (weekStartIso: string, actuals: { phaseId: string; actual: number }[], dest: CarryDest) => {
      if (!canEditCells) return;
      const weekIndex = weeks.indexOf(weekStartIso);
      if (weekIndex < 0) return;
      const activities = (billing.gcSchedule?.items ?? [])
        .filter((activity) => activity.name.trim())
        .map((activity) => ({
          id: activity.id,
          startIso: activity.startIso,
          endIso: activity.finishIso || activity.startIso,
          includeWeekends: activity.includeWeekends,
        }));
      const { weights } = weekActivityWeights(
        activities,
        weeks[0] ?? weekStartIso,
        weeks.length,
        "activity-days",
      );
      const grid = billing.manpowerCells
        .map((cell) => ({
          phaseId: cell.phaseId,
          weekIndex: weeks.indexOf(cell.weekStartIso),
          hours: cell.hours,
        }))
        .filter((cell) => cell.weekIndex >= 0);
      const snapshot = billing.manpowerCells.map((cell) => ({
        ...cell,
        dayHours: cell.dayHours?.slice(),
      }));
      const nextGrid = carryOver(grid, weekIndex, actuals, dest, weights);
      const phaseIds = new Set(actuals.map((row) => row.phaseId));
      let cells = billing.manpowerCells;
      for (const phaseId of phaseIds) {
        for (let index = 0; index < weeks.length; index += 1) {
          const before = grid.find((cell) => cell.phaseId === phaseId && cell.weekIndex === index)?.hours ?? 0;
          const after = nextGrid.find((cell) => cell.phaseId === phaseId && cell.weekIndex === index)?.hours ?? 0;
          if (Math.abs(before - after) > 1e-6) {
            cells = withCellHours(cells, phaseId, weeks[index]!, after);
          }
        }
      }
      const shortfall = actuals.reduce((sum, row) => {
        const planned = cellHours(billing.manpowerCells, row.phaseId, weekStartIso);
        const actual = Number.isFinite(row.actual) && row.actual > 0 ? row.actual : 0;
        return sum + Math.max(0, planned - actual);
      }, 0);
      const laterActive = weights.some((weight, index) => index > weekIndex && weight > 0);
      const qty = formatHoursPlain(shortfall);
      const nextWeek = weeks[weekIndex + 1];
      let message = `Updated week of ${weekColumnLabel(weekStartIso)}`;
      if (shortfall > 0 && dest === "next" && nextWeek) {
        message = `Carried ${qty} hrs to ${weekColumnLabel(nextWeek)}`;
      } else if (shortfall > 0 && dest === "spread" && laterActive) {
        message = `Carried ${qty} hrs across later weeks`;
      } else if (shortfall > 0) {
        message = `Parked ${qty} hrs`;
      }
      const nextBilling = { ...billing, manpowerCells: cells };
      onBillingChange(nextBilling);
      setCarryWeek(null);
      setCarryToast({ message, cells: snapshot });
      await onPersistQuiet(nextBilling);
    },
    [billing, canEditCells, onBillingChange, onPersistQuiet, weeks],
  );

  const undoCarry = useCallback(async () => {
    if (!canEditCells || !carryToast) return;
    const cells = carryToast.cells.map((cell) => ({ ...cell, dayHours: cell.dayHours?.slice() }));
    const weekCount = carryToast.weekCount;
    const endIso = carryToast.endIso;
    setCarryToast(null);
    const next = {
      ...billing,
      manpowerCells: cells,
      ...(weekCount != null ? { manpowerWeekCount: weekCount } : {}),
    };
    onBillingChange(next);
    await onPersistQuiet(next);
    if (endIso != null && onScheduleDatesChange) await onScheduleDatesChange(projectStartIso, endIso);
  }, [billing, canEditCells, carryToast, onBillingChange, onPersistQuiet, onScheduleDatesChange, projectStartIso]);

  async function addWeek() {
    if (!canEditSchedule) return;
    const nextEnd = projectEndIso.trim() ? shiftIsoDate(projectEndIso, 7) : null;
    if (nextEnd && onScheduleDatesChange) {
      await onScheduleDatesChange(projectStartIso, nextEnd);
      return;
    }
    const next = { ...billing, manpowerWeekCount: Math.max(billing.manpowerWeekCount, weeks.length) + 1 };
    onBillingChange(next);
    await onPersistQuiet(next);
  }

  async function pushScheduleWeek(fromWeek: string) {
    if (!canEditCells || saving) return;
    const phaseIds = new Set(contractPhases.map((phase) => phase.id));
    const moving = billing.manpowerCells.some(
      (cell) => cell.hours > 0 && phaseIds.has(cell.phaseId) && cell.weekStartIso >= fromWeek,
    );
    if (!moving) return;
    const snapshot = billing.manpowerCells.map((cell) => ({
      ...cell,
      dayHours: cell.dayHours?.slice(),
    }));
    const next = {
      ...billing,
      manpowerCells: billing.manpowerCells.map((cell) => {
        if (!phaseIds.has(cell.phaseId) || cell.weekStartIso < fromWeek) return cell;
        return {
          ...cell,
          weekStartIso: addWeeksIso(cell.weekStartIso, 1),
          dayHours: cell.dayHours?.slice(),
        };
      }),
    };
    onBillingChange(next);
    setCarryToast({
      message: `Pushed ${weekColumnLabel(fromWeek)} and later weeks 1 week later.`,
      cells: snapshot,
    });
    await onPersistQuiet(next);
    const lines = billing.rentalEquipment ?? [];
    const movable =
      lines.some((line) => line.onRentIso || line.offRentIso) || (billing.rentalEquipmentCells ?? []).length > 0;
    if (movable) {
      setRentalShift({ dayDelta: 7 });
      setRentalShiftIds(lines.filter((line) => line.status === "needed").map((line) => line.id));
    }
  }

  async function clearWeek(weekStartIso: string) {
    if (!canEditCells || saving) return;
    const phaseIds = new Set(contractPhases.map((phase) => phase.id));
    const hasHours = billing.manpowerCells.some(
      (cell) => cell.hours > 0 && phaseIds.has(cell.phaseId) && cell.weekStartIso === weekStartIso,
    );
    if (!hasHours) return;
    const snapshot = billing.manpowerCells.map((cell) => ({
      ...cell,
      dayHours: cell.dayHours?.slice(),
    }));
    const next = {
      ...billing,
      manpowerCells: billing.manpowerCells.filter(
        (cell) => !(phaseIds.has(cell.phaseId) && cell.weekStartIso === weekStartIso),
      ),
    };
    onBillingChange(next);
    setCarryToast({
      message: `Cleared hours for the week of ${weekColumnLabel(weekStartIso)}.`,
      cells: snapshot,
    });
    await onPersistQuiet(next);
  }

  function canDeleteWeek(weekStartIso: string): boolean {
    if (!canEditSchedule || weeks.length < 2 || weeks[weeks.length - 1] !== weekStartIso) return false;
    const endMonday = mondayIsoFromDateInput(projectEndIso);
    if (endMonday && endMonday >= weekStartIso) {
      const nextEnd = shiftIsoDate(projectEndIso, -7);
      const nextMonday = nextEnd ? mondayIsoFromDateInput(nextEnd) : null;
      const startMonday = mondayIsoFromDateInput(projectStartIso) ?? weeks[0] ?? weekStartIso;
      return Boolean(nextMonday && weekIndex(startMonday, nextMonday) >= 0);
    }
    if (!projectEndIso.trim()) return weeks.length > DEFAULT_MANPOWER_WEEK_COUNT;
    return billing.manpowerCells.some((cell) => cell.weekStartIso === weekStartIso);
  }

  async function deleteWeek(weekStartIso: string) {
    if (!canDeleteWeek(weekStartIso) || saving) return;
    const snapshot = billing.manpowerCells.map((cell) => ({
      ...cell,
      dayHours: cell.dayHours?.slice(),
    }));
    const previousCount = billing.manpowerWeekCount;
    const previousEnd = projectEndIso;
    const cells = billing.manpowerCells.filter((cell) => cell.weekStartIso !== weekStartIso);
    const next = { ...billing, manpowerCells: cells, manpowerWeekCount: Math.max(1, weeks.length - 1) };
    onBillingChange(next);
    const saved = await onPersistQuiet(next);
    const endMonday = mondayIsoFromDateInput(projectEndIso);
    const nextEnd = endMonday && endMonday >= weekStartIso ? shiftIsoDate(projectEndIso, -7) : null;
    let restoredEnd: string | undefined;
    if (saved && nextEnd && onScheduleDatesChange) {
      const datesSaved = await onScheduleDatesChange(projectStartIso, nextEnd);
      if (datesSaved) restoredEnd = previousEnd;
    }
    setCarryToast({
      message: `Deleted the week of ${weekColumnLabel(weekStartIso)}.`,
      cells: snapshot,
      weekCount: previousCount,
      ...(restoredEnd ? { endIso: restoredEnd } : {}),
    });
  }

  async function persistDates(nextStart: string, nextEnd: string) {
    if (!canEditSchedule || !onScheduleDatesChange) return;
    if (nextStart === projectStartIso && nextEnd === projectEndIso) return;
    await onScheduleDatesChange(nextStart, nextEnd);
  }

  async function setPhaseHidden(phaseId: ManpowerPhaseId, hidden: boolean) {
    if (!canEditCells || saving) return;
    const next = {
      ...billing,
      manpowerPhases: billing.manpowerPhases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        if (hidden) return { ...phase, hidden: true };
        const rest = { ...phase };
        delete rest.hidden;
        return rest;
      }),
    };
    onBillingChange(next);
    await onPersistQuiet(next);
  }

  const isField = variant === "field";

  const contractHours = useMemo(() => {
    const map = new Map<TransmittalContract, { budget: number; planned: number }>();
    for (const contract of contracts) {
      const phases = billing.manpowerPhases.filter((phase) => phase.contract === contract);
      map.set(contract, {
        budget: phases.reduce((sum, phase) => sum + phase.budgetHours, 0),
        planned: phases.reduce((sum, phase) => sum + plannedHoursForPhase(phase.id, billing.manpowerCells), 0),
      });
    }
    return map;
  }, [billing.manpowerCells, billing.manpowerPhases, contracts]);

  const gcItems = billing.gcSchedule?.items ?? [];
  const gcUnsent = gcItems.filter((item) => item.status === "open").length;

  const phaseIndexById = useMemo(() => {
    const map = new Map<string, number>();
    billing.manpowerPhases.forEach((phase, index) => map.set(phase.id, index));
    return map;
  }, [billing.manpowerPhases]);

  function rowMeta(phase: ManpowerPhase) {
    const planned = phaseTotalHours(billing.manpowerCells, phase.id);
    const left = phase.budgetHours - planned;
    const colors = phaseColorAtIndex(phaseIndexById.get(phase.id) ?? 0);
    return { planned, left, colors };
  }

  function hourSplit(phases: ManpowerPhase[]) {
    let budget = 0;
    let onBudget = 0;
    let unbudgeted = 0;
    const names: string[] = [];
    for (const phase of phases) {
      const planned = plannedHoursForPhase(phase.id, billing.manpowerCells);
      if (phase.budgetHours > 0) {
        budget += phase.budgetHours;
        onBudget += planned;
      } else if (planned > 0) {
        unbudgeted += planned;
        const name = (phase.name.trim() || phase.costCode || "unbudgeted").trim();
        if (name && !names.includes(name)) names.push(name);
      }
    }
    return { budget, onBudget, unbudgeted, names };
  }

  function hoursThroughWeek(phases: ManpowerPhase[], throughWeek: string) {
    const ids = new Set(phases.map((phase) => phase.id));
    let through = 0;
    let planned = 0;
    for (const cell of billing.manpowerCells) {
      if (!ids.has(cell.phaseId) || !(cell.hours > 0)) continue;
      planned += cell.hours;
      if (cell.weekStartIso <= throughWeek) through += cell.hours;
    }
    return { through, planned };
  }

  const selectedHours = contractHours.get(activeContract) ?? { budget: 0, planned: 0 };
  const selectedContractValue = contractValues?.[activeContract] ?? 0;
  const scopeMonths = deriveMonthlyHours(
    billing,
    weeks,
    new Set(contractPhases.map((phase) => phase.id)),
  );
  const scopeHourTotal = scopeMonths.reduce((sum, month) => sum + month.hours, 0);
  let hoursBefore = 0;
  let billableThrough = 0;
  const monthNow = currentMonthKey();
  for (const month of scopeMonths) {
    const prev = hoursBefore;
    hoursBefore += month.hours;
    if (month.key <= monthNow) {
      billableThrough += monthPocBillable(selectedContractValue, prev, hoursBefore, scopeHourTotal);
    }
  }
  const laborCost = selectedHours.planned * blendedCostRate(billing.calculatorLaborRates);
  const selectedSplit = hourSplit(contractPhases);
  const hoursShare =
    selectedSplit.budget > 0
      ? Math.max(0, Math.min(100, (selectedSplit.onBudget / selectedSplit.budget) * 100))
      : 0;
  const currentWeek = todayMondayIso();
  const visibleIds = new Set(visiblePhases.map((phase) => phase.id));
  const weekTotals = weeks.map((week) =>
    billing.manpowerCells
      .filter((cell) => cell.weekStartIso === week && visibleIds.has(cell.phaseId))
      .reduce((sum, cell) => sum + cell.hours, 0),
  );
  const showWeekly = isField || !monthlyBilling || planView === "weekly";

  async function printWeeklyHours(measure: WeeklyPrintMeasure, layout: WeeklyPrintLayout, hideEquipmentPricing = false) {
    setPrintBusy(true);
    setPrintError(null);
    try {
      const { buildWeeklyHoursPdf } = await import("../../lib/weeklyHoursPdf");
      const bytes = await buildWeeklyHoursPdf({
        jobNumber,
        jobName,
        contractLabel: TRANSMITTAL_CONTRACT_LABELS[activeContract],
        weekStarts: weeks,
        phases: visiblePhases.map((phase) => ({ id: phase.id, costCode: phase.costCode, name: phase.name })),
        cells: billing.manpowerCells,
        holidays: billing.holidays ?? [],
        rainDays: billing.rainDays ?? [],
        delayDays: billing.delayDays ?? [],
        measure,
        layout,
        equipment: (billing.rentalEquipment ?? [])
          .filter((item) => item.name.trim())
          .map((item) => {
            const weekOverrides = new Map<string, number>();
            const dayOverrides = new Map<string, number>();
            for (const cell of billing.rentalEquipmentCells ?? []) {
              if (cell.equipmentId !== item.id) continue;
              if (cell.dayIso) dayOverrides.set(cell.dayIso, cell.quantity);
              else weekOverrides.set(cell.weekStartIso, cell.quantity);
            }
            const holidays = billing.holidays ?? [];
            const quote = rentalQuoteForLine(item, holidays);
            const weekQuantity = (week: string) => (weekOverrides.has(week) ? weekOverrides.get(week)! : null);
            const dayQuantity = (iso: string) => (dayOverrides.has(iso) ? dayOverrides.get(iso)! : null);
            return {
              name: item.name.trim(),
              labels: weeks.map(
                (week) => rentalWeekFill(item, week, weekQuantity(week), holidays)?.label ?? "",
              ),
              dayLabels: weeks.flatMap((week) =>
                weekDayIsos(week).map((iso) => {
                  const fill = rentalDayFill(item, iso, weekQuantity(week), dayQuantity(iso), holidays);
                  return fill && fill.quantity > 0 ? "X" : "";
                }),
              ),
              quantities: weeks.map((week) => rentalWeekFill(item, week, weekQuantity(week), holidays)?.quantity ?? 0),
              costLabel: hideEquipmentPricing || !(quote && quote.total > 0) ? "" : formatMoney0(quote.total),
            };
          }),
      });
      downloadPdfBytes(bytes, weeklyHoursPdfFilename(jobName, jobNumber));
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : "Could not save the weekly hours.");
    } finally {
      setPrintBusy(false);
    }
  }

  return (
    <section
      data-contract={gcOpen ? undefined : activeContract}
      className={`card stack billing-card billing-manpower-card${isField ? " billing-manpower-card--field" : ""}${dragFill ? " is-dragging-hours" : ""}`}
    >
      <div className="lp-header">
        <button
          type="button"
          className="lp-date-chip"
          aria-expanded={datesOpen}
          onClick={() => setDatesOpen((open) => !open)}
        >
          <ManpowerHeaderPencilIcon />
          {shortScheduleDate(projectStartIso)} – {shortScheduleDate(projectEndIso)} · {weeks.length} wk
          {weeks.length === 1 ? "" : "s"}
        </button>
      </div>
      {datesOpen ? (
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
        </div>
      ) : null}

      <div className="lp-scopes" role="tablist" aria-label="Labor projection">
        {contracts.map((contract) => {
          const phases = billing.manpowerPhases.filter((phase) => phase.contract === contract);
          const split = hourSplit(phases);
          const pace = hoursThroughWeek(phases, currentWeek);
          const share =
            pace.planned > 0 ? Math.max(0, Math.min(100, (pace.through / pace.planned) * 100)) : 0;
          const selected = !gcOpen && activeContract === contract;
          const dollars = contractValues?.[contract];
          return (
            <button
              key={contract}
              type="button"
              role="tab"
              data-contract={contract}
              aria-selected={selected}
              className={`lp-scope-card${selected ? " active" : ""}`}
              onClick={() => {
                setGcOpen(false);
                setActiveContract(contract);
              }}
            >
              <span className="billing-manpower-tab-name">
                <span className="billing-manpower-trade-dot" aria-hidden />
                {TRANSMITTAL_CONTRACT_LABELS[contract]}
              </span>
              <span className="billing-manpower-tab-budget">
                {formatHoursPlain(pace.through)} of {formatHoursPlain(pace.planned)} hrs through this week
                {dollars != null ? ` · ${formatMoney0(dollars)}` : ""}
              </span>
              {split.unbudgeted > 0 ? (
                <span className="muted small">
                  +{formatHoursPlain(split.unbudgeted)} {split.names.join(", ").toLowerCase()}
                </span>
              ) : null}
              <span className="billing-manpower-tab-meter" aria-hidden>
                <span style={{ width: `${share}%` }} />
              </span>
            </button>
          );
        })}
        <div className={`lp-scope-gc${gcOpen ? " is-open" : ""}`} data-gc-menu="">
          <button
            type="button"
            role="tab"
            aria-selected={gcOpen}
            className={`lp-scope-card lp-scope-card--gc${gcOpen ? " active" : ""}`}
            onClick={() => {
              setGcMenu(false);
              setGcOpen(true);
            }}
          >
            <span className="billing-manpower-tab-name">
              <GcFileIcon />
              GC schedule
              {gcItems.length > 0 ? <span className="billing-manpower-gc-count">{gcItems.length}</span> : null}
            </span>
            <span className="billing-manpower-tab-budget">
              {gcItems.length === 0 ? "No schedule" : gcUnsent > 0 ? `${gcUnsent} not sent` : "All sent"}
            </span>
          </button>
          {canEditCells ? (
            <button
              type="button"
              className="lp-scope-gc-caret"
              aria-haspopup="menu"
              aria-expanded={gcMenu}
              aria-label="GC schedule menu"
              onClick={() => setGcMenu((open) => !open)}
            >
              ▾
            </button>
          ) : null}
          {gcMenu && canEditCells ? (
            <div className="billing-week-menu lp-scope-gc-pop" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={saving}
                onClick={() => {
                  setGcMenu(false);
                  setGcOpen(true);
                  setImportLaunch((current) => current + 1);
                }}
              >
                Import GC schedule
              </button>
            </div>
          ) : null}
        </div>
        {canEditCells ? (
          <GcScheduleImport
            billing={billing}
            phases={billing.manpowerPhases}
            weekStarts={weeks}
            projectStartIso={projectStartIso}
            projectEndIso={projectEndIso}
            projectId={projectId}
            jobNumber={jobNumber}
            saving={saving}
            onBillingChange={onBillingChange}
            onPersistQuiet={onPersistQuiet}
            onStored={() => setGcOpen(true)}
            launch={importLaunch}
            hideButton
          />
        ) : null}
      </div>

      {!gcOpen ? (
        <div className="lp-strip" data-contract={activeContract}>
          <div className="lp-strip-cell">
            <span className="lp-strip-label">Hours planned</span>
            <strong>{formatHoursPlain(selectedSplit.onBudget)}</strong>
            <span className="muted small">of {formatHoursPlain(selectedSplit.budget)} budget</span>
            {selectedSplit.unbudgeted > 0 ? (
              <span className="muted small">
                +{formatHoursPlain(selectedSplit.unbudgeted)} hrs unbudgeted ({selectedSplit.names.join(", ")})
              </span>
            ) : null}
            <span className="billing-manpower-tab-meter" aria-hidden>
              <span style={{ width: `${hoursShare}%` }} />
            </span>
          </div>
          <div className="lp-strip-cell">
            <span className="lp-strip-label">Man-weeks</span>
            <strong>{formatManWeeks(selectedHours.planned)}</strong>
            <span className="muted small">40 hrs each</span>
          </div>
          <div className="lp-strip-cell">
            <span className="lp-strip-label">Labor cost</span>
            <strong>{formatMoney0(laborCost)}</strong>
          </div>
          <div className="lp-strip-cell">
            <span className="lp-strip-label">Contract</span>
            <strong>{formatMoney0(selectedContractValue)}</strong>
            <span className="muted small">
              {formatMoney0(billableThrough)} billable through {currentMonthLabel()}
            </span>
          </div>
        </div>
      ) : null}

      {!gcOpen && monthlyBilling ? (
        <div className="lp-subtabs" role="tablist" aria-label="Projection view" data-contract={activeContract}>
          <button
            type="button"
            role="tab"
            aria-selected={planView === "weekly"}
            className={planView === "weekly" ? "active" : ""}
            onClick={() => setPlanView("weekly")}
          >
            Weekly hours
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={planView === "monthly"}
            className={planView === "monthly" ? "active" : ""}
            onClick={() => setPlanView("monthly")}
          >
            Monthly billing
          </button>
        </div>
      ) : null}

      {gcOpen ? (
        <GcSchedulePanel
          billing={billing}
          phases={billing.manpowerPhases}
          weekStarts={weeks}
          projectStartIso={projectStartIso}
          projectEndIso={projectEndIso}
          projectId={projectId}
          jobNumber={jobNumber}
          saving={saving}
          canEdit={canEditCells}
          gridStart={weeks[0] ?? ""}
          weekCount={weeks.length}
          spreadCanUndo={spreadCanUndo}
          onSpreadPreview={showSpreadPreview}
          onSpreadApply={(rows, savedItems) => void applySpread(rows, savedItems)}
          onSpreadUndo={() => void undoSpread()}
          onBillingChange={onBillingChange}
          onPersistQuiet={onPersistQuiet}
        />
      ) : null}

      {!gcOpen && endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : null}

      {showWeekly && hiddenPhases.length > 0 ? (
        <div className="billing-manpower-hidden">
          <span className="muted small">Hidden</span>
          {hiddenPhases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className="billing-manpower-show"
              disabled={!canEditCells || saving}
              onClick={() => void setPhaseHidden(phase.id, false)}
            >
              Show {phase.costCode || phase.name}
            </button>
          ))}
        </div>
      ) : null}

      {!showWeekly ? null : contractPhases.length === 0 ? (
        <p className="muted small billing-manpower-empty">
          No Hours PDF lines for {TRANSMITTAL_CONTRACT_LABELS[activeContract]}. Unhide labor cost codes in Budget Maker
          to project this contract.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="billing-manpower-scroll"
          tabIndex={0}
          aria-label="Labor Projection weeks — scroll horizontally"
            style={
              phaseColPx > 0
                ? ({
                    "--manpower-phase-w": `${phaseColPx}px`,
                    "--manpower-budget-left": `${phaseColPx}px`,
                    "--manpower-planned-left": `${phaseColPx + 68}px`,
                    "--manpower-left-left": `${phaseColPx + 136}px`,
                  } as CSSProperties)
                : undefined
            }
        >
          <table className="billing-manpower-table billing-manpower-table--plan" data-contract={activeContract}>
            <thead>
              <tr>
                <th className="billing-manpower-sticky billing-manpower-phase-col">Cost code</th>
                {weeks.map((w, weekIdx) => {
                  const weekIsos = weekDayIsos(w);
                  const weekMarks = [
                    weekIsos.some((iso) => (billing.holidays ?? []).includes(iso)) ? "Hol" : "",
                    weekIsos.some((iso) => (billing.rainDays ?? []).includes(iso)) ? "Rain" : "",
                    weekIsos.some((iso) => (billing.delayDays ?? []).includes(iso)) ? "Delay" : "",
                  ].filter(Boolean);
                  const holiday = weekMarks.includes("Hol");
                  return (
                  <th
                    key={w}
                    className={`billing-manpower-week-col num${
                      w === currentWeek ? " billing-manpower-week-col--current" : ""
                    }${
                      contractEndWeekIndex !== null && weekIdx > contractEndWeekIndex
                        ? " billing-manpower-week-col--beyond-contract"
                        : ""
                    }${holiday ? " billing-manpower-week-col--holiday" : ""}`}
                  >
                    {canEditCells ? (
                      <div className="billing-week-head">
                        <button
                          type="button"
                          className="billing-manpower-header-pill"
                          data-week-menu=""
                          aria-haspopup="menu"
                          aria-expanded={weekMenu?.week === w}
                          title={
                            weekMarks.length
                              ? `Week of ${weekColumnLabel(w)} · ${weekMarks.join(", ")}`
                              : `Week of ${weekColumnLabel(w)}`
                          }
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setWeekMenu((current) =>
                              current?.week === w
                                ? null
                                : {
                                    week: w,
                                    top: rect.bottom + 4,
                                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 168)),
                                  },
                            );
                          }}
                        >
                          <ManpowerHeaderPencilIcon />
                          {weekColumnLabel(w)}
                          {weekMarks.map((mark) => (
                            <span key={mark} className={`billing-week-block-mark is-${mark.toLowerCase()}`}>
                              {mark}
                            </span>
                          ))}
                          <span className="billing-week-caret" aria-hidden>
                            ▾
                          </span>
                        </button>
                      </div>
                    ) : (
                      <span className="billing-manpower-header-pill billing-manpower-header-pill--readonly">
                        {weekColumnLabel(w)}
                        {weekMarks.map((mark) => (
                          <span key={mark} className={`billing-week-block-mark is-${mark.toLowerCase()}`}>
                            {mark}
                          </span>
                        ))}
                      </span>
                    )}
                  </th>
                  );
                })}
                <th className="billing-manpower-sticky billing-manpower-total-col num">Man-wks</th>
                <th className="billing-manpower-sticky billing-manpower-total-col num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {visiblePhases.map((phase) => {
                const { planned, left, colors } = rowMeta(phase);
                const over = left < 0;
                const budgetLine =
                  phase.budgetHours > 0
                    ? `${formatHoursPlain(planned)} of ${formatHoursPlain(phase.budgetHours)} · ${formatHoursPlain(left)} left`
                    : `${formatHoursPlain(planned)} planned · no budget`;
                return (
                  <tr key={phase.id}>
                    <td
                      className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-phase-name"
                      style={{ "--phase-stripe": colors.border } as CSSProperties}
                      title={phaseDisplayLabel(phase)}
                    >
                      <span className="billing-manpower-phase-code">{phase.costCode || "—"}</span>
                      {phase.name.trim() &&
                      phase.name.trim() !== (phase.costCode || "").trim() ? (
                        <span className="billing-manpower-phase-desc">{phase.name.trim()}</span>
                      ) : null}
                      <span className={`billing-manpower-phase-meta${over ? " billing-manpower-left--over" : ""}`}>
                        {budgetLine}
                      </span>
                      {canEditCells ? (
                        <button
                          type="button"
                          className="billing-manpower-hide"
                          title={`Hide ${phaseDisplayLabel(phase)}`}
                          aria-label={`Hide ${phaseDisplayLabel(phase)}`}
                          disabled={saving}
                          onClick={() => void setPhaseHidden(phase.id, true)}
                        >
                          Hide
                        </button>
                      ) : null}
                    </td>
                    {weeks.map((w) => {
                      const hrs = cellHours(billing.manpowerCells, phase.id, w);
                      const previewHours = spreadPreview?.[phase.id]?.[weeks.indexOf(w)];
                      return (
                        <td
                          key={w}
                          className={`billing-manpower-week-col${w === currentWeek ? " billing-manpower-week-col--current" : ""}`}
                          data-manpower-phase={phase.id}
                          data-manpower-week={w}
                        >
                          {previewHours !== undefined ? (
                            <span
                              className={`billing-manpower-chip billing-manpower-chip--preview${previewHours > 0 ? "" : " billing-manpower-chip--empty"}`}
                              aria-label={`Preview ${previewHours} hours for ${phaseDisplayLabel(phase)} week ${weekColumnLabel(w)}`}
                            >
                              {previewHours > 0 ? formatHours(previewHours) : "—"}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={`billing-manpower-chip${hrs > 0 ? "" : " billing-manpower-chip--empty"}${dragMarks(phase.id, w) ? " billing-manpower-chip--drag" : ""}`}
                              style={
                                hrs > 0
                                  ? {
                                      background: colors.bg,
                                      borderColor: colors.border,
                                      color: colors.text,
                                    }
                                  : undefined
                              }
                              data-manpower-phase={phase.id}
                              data-manpower-week={w}
                              disabled={!canEditCells}
                              onPointerDown={(event) => {
                                if (!canEditCells || event.button !== 0) return;
                                dragRef.current = {
                                  phaseId: phase.id,
                                  anchorWeek: w,
                                  currentWeek: w,
                                  startX: event.clientX,
                                  startY: event.clientY,
                                  moved: false,
                                  pointerId: event.pointerId,
                                };
                                event.currentTarget.setPointerCapture(event.pointerId);
                              }}
                              onPointerMove={(event) => {
                                const drag = dragRef.current;
                                if (!drag || drag.pointerId !== event.pointerId) return;
                                const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
                                if (!drag.moved && distance < 6) return;
                                drag.moved = true;
                                const scroller = scrollRef.current;
                                if (scroller) {
                                  const edge = scroller.getBoundingClientRect();
                                  if (event.clientX > edge.right - 40) scroller.scrollLeft += 16;
                                  else if (event.clientX < edge.left + 40) scroller.scrollLeft -= 16;
                                }
                                const week = weekUnderPointer(event.clientX, event.clientY, drag.phaseId) ?? drag.currentWeek;
                                drag.currentWeek = week;
                                setDragFill((current) =>
                                  current &&
                                  current.phaseId === drag.phaseId &&
                                  current.anchorWeek === drag.anchorWeek &&
                                  current.currentWeek === week
                                    ? current
                                    : { phaseId: drag.phaseId, anchorWeek: drag.anchorWeek, currentWeek: week },
                                );
                              }}
                              onPointerUp={(event) => {
                                const drag = dragRef.current;
                                if (!drag || drag.pointerId !== event.pointerId) return;
                                dragRef.current = null;
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                  event.currentTarget.releasePointerCapture(event.pointerId);
                                }
                                if (!drag.moved) {
                                  setDragFill(null);
                                  setWeekMenu(null);
                                  setDetailWeek(w);
                                  return;
                                }
                                void moveDraggedHours(drag.phaseId, drag.anchorWeek, drag.currentWeek);
                              }}
                              onPointerCancel={() => {
                                dragRef.current = null;
                                setDragFill(null);
                              }}
                              title={
                                hrs > 0
                                  ? `${formatHours(hrs)} hrs · ${formatManWeeks(hrs)} man-wk · open Plan week to change · drag to another week to move`
                                  : canEditCells
                                    ? "Open Plan week"
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
                {weeks.map((w, weekIdx) => {
                  const total = weekTotals[weekIdx] ?? 0;
                  const overlap = weekHasPhaseOverlap(
                    billing.manpowerCells.filter((c) => visibleIds.has(c.phaseId)),
                    w,
                  );
                  return (
                    <td
                      key={w}
                      className={`billing-manpower-week-col num billing-manpower-week-total${overlap ? " billing-manpower-week-total--overlap" : ""}${w === currentWeek ? " billing-manpower-week-col--current" : ""}`}
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

      {!gcOpen && showWeekly && !isField ? (
        <RentalEquipmentSection
          billing={billing}
          weeks={weeks}
          canEdit={canEditCells}
          saving={saving}
          onSave={(next) => {
            onBillingChange(next);
            void onPersistQuiet(next);
          }}
        />
      ) : null}

      {!gcOpen && !showWeekly ? monthlyBilling : null}

      {!gcOpen && (showWeekly || canEditSchedule) ? (
        <div className="lp-week-foot">
          {showWeekly ? (
            <p className="muted small billing-manpower-caption">
              {isField
                ? `Tap a cell to open Plan week · drag a week onto another week to move the hours · ${HOURS_PER_MAN_WEEK} hrs = 1 man-week`
                : `Open Plan week to change hours · drag a week onto another week to move the hours · ${HOURS_PER_MAN_WEEK} hrs = 1 man-week`}
            </p>
          ) : (
            <span />
          )}
          <div className="lp-week-foot-actions">
            {showWeekly && visiblePhases.length > 0 ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPrintError(null); setPrintOpen(true); }}>
                Print
              </button>
            ) : null}
            {canEditSchedule ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addWeek()} disabled={saving}>
                + Add week
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!gcOpen && detailWeek && canEditCells && contractPhases.length > 0 ? (
        <ManpowerWeekDetailModal
          weekStartIso={detailWeek}
          billing={billing}
          phases={visiblePhases}
          saving={saving}
          onClose={() => setDetailWeek(null)}
          onSave={saveWeekDetail}
        />
      ) : null}

      {weekMenu ? (
        <div
          className="billing-week-menu"
          data-week-menu=""
          role="menu"
          style={{ top: weekMenu.top, left: weekMenu.left }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const week = weekMenu.week;
              setWeekMenu(null);
              setDetailWeek(week);
            }}
          >
            Plan week
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const week = weekMenu.week;
              setWeekMenu(null);
              setCarryWeek(week);
            }}
          >
            Adjust week
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={saving}
            onClick={() => {
              const week = weekMenu.week;
              setWeekMenu(null);
              void pushScheduleWeek(week);
            }}
          >
            Push 1 week
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={saving || !billing.manpowerCells.some(
              (cell) => cell.weekStartIso === weekMenu.week && cell.hours > 0 && contractPhases.some((phase) => phase.id === cell.phaseId),
            )}
            onClick={() => {
              const week = weekMenu.week;
              setWeekMenu(null);
              void clearWeek(week);
            }}
          >
            Clear week
          </button>
          {canDeleteWeek(weekMenu.week) ? (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={saving}
              onClick={() => {
                const week = weekMenu.week;
                setWeekMenu(null);
                void deleteWeek(week);
              }}
            >
              Delete week
            </button>
          ) : null}
        </div>
      ) : null}

      {!gcOpen && carryWeek && canEditCells ? (
        <CarryWeekSheet
          weekLabel={weekColumnLabel(carryWeek)}
          nextWeekLabel={(() => {
            const next = weeks[weeks.indexOf(carryWeek) + 1];
            return next ? weekColumnLabel(next) : null;
          })()}
          isLastWeek={weeks.indexOf(carryWeek) >= weeks.length - 1}
          key={carryWeek}
          rows={contractPhases
            .map((phase) => ({
              phaseId: phase.id,
              code: phase.costCode || "—",
              name:
                phase.name.trim() && phase.name.trim() !== (phase.costCode || "").trim()
                  ? phase.name.trim()
                  : "",
              planned: cellHours(billing.manpowerCells, phase.id, carryWeek),
            }))
            .filter((row) => row.planned > 0)}
          saving={saving}
          onCancel={() => setCarryWeek(null)}
          onApply={(actuals, dest) => void applyCarry(carryWeek, actuals, dest)}
        />
      ) : null}

      {rentalShift ? (
        <RentalShiftDialog
          dayDelta={rentalShift.dayDelta}
          lines={billing.rentalEquipment ?? []}
          checked={new Set(rentalShiftIds)}
          onToggle={(id) =>
            setRentalShiftIds((current) =>
              current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
            )
          }
          onCancel={() => setRentalShift(null)}
          onApply={() => {
            const ids = new Set(rentalShiftIds);
            const next = {
              ...billing,
              rentalEquipment: billing.rentalEquipment.map((line) =>
                ids.has(line.id) ? shiftRentalLine(line, rentalShift.dayDelta) : line,
              ),
              rentalEquipmentCells: billing.rentalEquipmentCells.map((cell) =>
                ids.has(cell.equipmentId)
                  ? {
                      ...cell,
                      weekStartIso: addDaysIso(cell.weekStartIso, rentalShift.dayDelta),
                      ...(cell.dayIso ? { dayIso: addDaysIso(cell.dayIso, rentalShift.dayDelta) } : {}),
                    }
                  : cell,
              ),
            };
            onBillingChange(next);
            void onPersistQuiet(next);
            setRentalShift(null);
          }}
        />
      ) : null}

      {printOpen ? (
        <WeeklyHoursPrintDialog
          busy={printBusy}
          error={printError}
          onClose={() => { if (!printBusy) setPrintOpen(false); }}
          onPrint={(measure, layout, hideEquipmentPricing) => void printWeeklyHours(measure, layout, hideEquipmentPricing)}
        />
      ) : null}

      {carryToast ? (
        <div className="carry-toast" role="status">
          <span>{carryToast.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void undoCarry()}>
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}