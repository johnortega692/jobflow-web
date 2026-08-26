/**
 * Project manpower plan — stored in projects.data.billing (hours only).
 * Rows are Budget Maker Hours-PDF cost codes (per contract), not fixed coats.
 */

import type { TransmittalContract } from "../lib/jobInfo";
import { normalizeTransmittalContract } from "../lib/jobInfo";
import {
  defaultCalculatorLaborRates,
  normalizeCalculatorLaborRates,
  type CalculatorLaborRate,
} from "../lib/manpowerCalculator";

/** @deprecated Legacy coat rows; kept for migration detection only. */
export const MANPOWER_PHASE_DEFS = [
  { id: "prime", name: "Prime / 1st coat" },
  { id: "final", name: "Final coat" },
  { id: "punch", name: "Touch-up / punch" },
] as const;

export type LegacyManpowerPhaseId = (typeof MANPOWER_PHASE_DEFS)[number]["id"];

/** Phase / row id — typically `{contract}:{costCode}` e.g. `paint:901`. */
export type ManpowerPhaseId = string;

export type ManpowerPhase = {
  id: ManpowerPhaseId;
  name: string;
  costCode: string;
  contract: TransmittalContract;
  budgetHours: number;
  actualHours: number;
};

export type ManpowerCell = {
  phaseId: ManpowerPhaseId;
  weekStartIso: string;
  /** Planned labor hours for this phase during this week (sum of dayHours when set). */
  hours: number;
  /**
   * Optional Mon–Sun daily hours for this week.
   * When present, `hours` should equal the sum of the seven values.
   */
  dayHours?: number[];
};

export type ManpowerPeriodActual = {
  phaseId: ManpowerPhaseId;
  /** YYYY-MM for monthly actuals, YYYY-MM-DD (Monday) for weekly. */
  periodKey: string;
  actualHours: number;
};

/** Hours + monthly calculator fields persisted per project in projects.data.billing. */
export type ProjectBillingData = {
  version: 1;
  manpowerPhases: ManpowerPhase[];
  manpowerCells: ManpowerCell[];
  manpowerPeriodActuals: ManpowerPeriodActual[];
  /** Number of week columns seeded from project start (default 8); add-week increments. */
  manpowerWeekCount: number;
  /** Cost calculator labor class rates. */
  calculatorLaborRates: CalculatorLaborRate[];
  /** monthKey (YYYY-MM) → material cost entered for that month. */
  monthMaterial: Record<string, number>;
  /** `${contract}:${monthKey}` → fixed amount billed to GC. */
  monthBilled: Record<string, number>;
};

export const BILLING_DATA_KEY = "billing" as const;

export const HOURS_PER_MAN_WEEK = 40;

export type ManpowerPhaseColor = { bg: string; border: string; text: string };

export const MANPOWER_PHASE_PALETTE: ManpowerPhaseColor[] = [
  { bg: "rgba(37, 99, 235, 0.18)", border: "#2563eb", text: "#93c5fd" },
  { bg: "rgba(22, 163, 74, 0.18)", border: "#16a34a", text: "#86efac" },
  { bg: "rgba(202, 138, 4, 0.2)", border: "#ca8a04", text: "#fde047" },
  { bg: "rgba(147, 51, 234, 0.18)", border: "#9333ea", text: "#d8b4fe" },
  { bg: "rgba(219, 39, 119, 0.18)", border: "#db2777", text: "#f9a8d4" },
  { bg: "rgba(234, 88, 12, 0.18)", border: "#ea580c", text: "#fdba74" },
  { bg: "rgba(8, 145, 178, 0.18)", border: "#0891b2", text: "#67e8f9" },
  { bg: "rgba(101, 163, 13, 0.18)", border: "#65a30d", text: "#bef264" },
];

/** @deprecated Prefer phaseColorAtIndex — coat palette kept for old CSS vars. */
export const PHASE_COLORS: Record<LegacyManpowerPhaseId, ManpowerPhaseColor> = {
  prime: { bg: "rgba(167, 139, 250, 0.22)", border: "#a78bfa", text: "#c4b5fd" },
  final: { bg: "rgba(79, 140, 255, 0.2)", border: "#4f8cff", text: "#9ec0ff" },
  punch: { bg: "rgba(45, 212, 191, 0.18)", border: "#2dd4bf", text: "#5eead4" },
};

export function phaseColorAtIndex(index: number): ManpowerPhaseColor {
  return MANPOWER_PHASE_PALETTE[index % MANPOWER_PHASE_PALETTE.length]!;
}

export function isLegacyCoatPhaseId(id: string): boolean {
  return id === "prime" || id === "final" || id === "punch";
}

export function manpowerPhaseId(contract: TransmittalContract, costCode: string): string {
  const code = costCode.trim();
  return `${contract}:${code}`;
}

export function defaultManpowerPhases(): ManpowerPhase[] {
  return [];
}

export function defaultProjectBilling(): ProjectBillingData {
  return {
    version: 1,
    manpowerPhases: defaultManpowerPhases(),
    manpowerCells: [],
    manpowerPeriodActuals: [],
    manpowerWeekCount: 8,
    calculatorLaborRates: defaultCalculatorLaborRates(),
    monthMaterial: {},
    monthBilled: {},
  };
}

function normalizeMoneyMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k) continue;
    const amount = num(value);
    if (amount > 0) out[k] = amount;
  }
  return out;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function contractFromPhaseId(id: string, rawContract: unknown): TransmittalContract {
  if (typeof rawContract === "string" && rawContract.trim()) {
    return normalizeTransmittalContract(rawContract);
  }
  const prefix = id.split(":")[0] ?? "";
  if (prefix === "wallcovering" || prefix === "frp" || prefix === "track" || prefix === "paint") {
    return prefix;
  }
  return "paint";
}

function normalizeManpowerPhase(raw: unknown): ManpowerPhase | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id).trim();
  if (!id) return null;

  if (isLegacyCoatPhaseId(id)) {
    const def = MANPOWER_PHASE_DEFS.find((d) => d.id === id)!;
    return {
      id,
      name: def.name,
      costCode: "",
      contract: "paint",
      budgetHours: num(o.budgetHours),
      actualHours: num(o.actualHours),
    };
  }

  const costCode =
    str(o.costCode).trim() ||
    (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);
  const name = str(o.name).trim() || (costCode ? `${costCode}` : id);
  return {
    id,
    name,
    costCode,
    contract: contractFromPhaseId(id, o.contract),
    budgetHours: num(o.budgetHours),
    actualHours: num(o.actualHours),
  };
}

export function normalizeManpowerPhases(raw: unknown): ManpowerPhase[] {
  if (!Array.isArray(raw)) return [];
  const out: ManpowerPhase[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const phase = normalizeManpowerPhase(item);
    if (!phase || seen.has(phase.id)) continue;
    seen.add(phase.id);
    out.push(phase);
  }
  return out;
}

function normalizeDayHours(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 7) return undefined;
  const days = raw.map((v) => num(v));
  if (days.every((h) => h <= 0)) return undefined;
  return days;
}

function normalizeManpowerCell(raw: unknown): ManpowerCell | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phaseId = str(o.phaseId).trim();
  if (!phaseId) return null;
  const weekStartIso = str(o.weekStartIso).trim();
  if (!weekStartIso) return null;
  const dayHours = normalizeDayHours(o.dayHours);
  const hoursFromDays = dayHours ? dayHours.reduce((sum, h) => sum + h, 0) : 0;
  const hours =
    dayHours && hoursFromDays > 0
      ? hoursFromDays
      : o.hours !== undefined
        ? num(o.hours)
        : num(o.crewCount) * HOURS_PER_MAN_WEEK;
  if (hours <= 0) return null;
  const cell: ManpowerCell = { phaseId, weekStartIso, hours };
  if (dayHours) cell.dayHours = dayHours;
  return cell;
}

export function normalizeManpowerCells(raw: unknown): ManpowerCell[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeManpowerCell).filter((r): r is ManpowerCell => Boolean(r));
}

function normalizeManpowerPeriodActual(raw: unknown): ManpowerPeriodActual | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phaseId = str(o.phaseId).trim();
  if (!phaseId) return null;
  const periodKey = str(o.periodKey).trim();
  if (!periodKey) return null;
  const actualHours = num(o.actualHours);
  if (actualHours <= 0) return null;
  return { phaseId, periodKey, actualHours };
}

function normalizeManpowerPeriodActuals(raw: unknown): ManpowerPeriodActual[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeManpowerPeriodActual).filter((r): r is ManpowerPeriodActual => Boolean(r));
}

export function normalizeProjectBilling(raw: unknown): ProjectBillingData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultProjectBilling();
  }
  const o = raw as Record<string, unknown>;
  const rates = normalizeCalculatorLaborRates(o.calculatorLaborRates);
  return {
    version: 1,
    manpowerPhases: normalizeManpowerPhases(o.manpowerPhases),
    manpowerCells: normalizeManpowerCells(o.manpowerCells),
    manpowerPeriodActuals: normalizeManpowerPeriodActuals(o.manpowerPeriodActuals),
    manpowerWeekCount: Math.max(1, Math.round(num(o.manpowerWeekCount, 8)) || 8),
    calculatorLaborRates: rates.length ? rates : defaultCalculatorLaborRates(),
    monthMaterial: normalizeMoneyMap(o.monthMaterial),
    monthBilled: normalizeMoneyMap(o.monthBilled),
  };
}

export function monthBilledMapKey(contract: string, monthKey: string): string {
  return `${contract}:${monthKey}`;
}

export function getMonthMaterialCost(billing: ProjectBillingData, monthKey: string): number {
  return num(billing.monthMaterial[monthKey]);
}

export function withMonthMaterialCost(
  billing: ProjectBillingData,
  monthKey: string,
  materialCost: number,
): ProjectBillingData {
  const next = { ...billing.monthMaterial };
  const amount = num(materialCost);
  if (amount <= 0) delete next[monthKey];
  else next[monthKey] = amount;
  return { ...billing, monthMaterial: next };
}

export function getMonthBilledAmount(
  billing: ProjectBillingData,
  contract: string,
  monthKey: string,
): number {
  return num(billing.monthBilled[monthBilledMapKey(contract, monthKey)]);
}

export function withMonthBilledAmount(
  billing: ProjectBillingData,
  contract: string,
  monthKey: string,
  billedAmount: number,
): ProjectBillingData {
  const key = monthBilledMapKey(contract, monthKey);
  const next = { ...billing.monthBilled };
  const amount = num(billedAmount);
  if (amount <= 0) delete next[key];
  else next[key] = amount;
  return { ...billing, monthBilled: next };
}

export function withCalculatorLaborRates(
  billing: ProjectBillingData,
  rates: CalculatorLaborRate[],
): ProjectBillingData {
  const cleaned = normalizeCalculatorLaborRates(rates);
  return {
    ...billing,
    calculatorLaborRates: cleaned.length ? cleaned : defaultCalculatorLaborRates(),
  };
}

export function parseProjectBilling(projectData: unknown): ProjectBillingData {
  const blob =
    projectData && typeof projectData === "object" && !Array.isArray(projectData)
      ? (projectData as Record<string, unknown>)
      : {};
  return normalizeProjectBilling(blob[BILLING_DATA_KEY]);
}

export function plannedHoursForPhase(phaseId: ManpowerPhaseId, cells: ManpowerCell[]): number {
  return cells.filter((c) => c.phaseId === phaseId).reduce((sum, c) => sum + c.hours, 0);
}

export function phaseActualHours(phase: ManpowerPhase, periodActuals: ManpowerPeriodActual[]): number {
  const fromPeriods = periodActuals
    .filter((a) => a.phaseId === phase.id)
    .reduce((sum, a) => sum + a.actualHours, 0);
  if (periodActuals.some((a) => a.phaseId === phase.id)) return fromPeriods;
  return phase.actualHours;
}

export function totalPlannedHours(billing: ProjectBillingData): number {
  return billing.manpowerCells.reduce((sum, c) => sum + c.hours, 0);
}

export function totalActualHours(billing: ProjectBillingData): number {
  return billing.manpowerPhases.reduce(
    (sum, p) => sum + phaseActualHours(p, billing.manpowerPeriodActuals),
    0,
  );
}

export function phaseDisplayLabel(phase: ManpowerPhase): string {
  if (phase.costCode && phase.name && phase.name !== phase.costCode) {
    return `${phase.costCode} · ${phase.name}`;
  }
  return phase.name || phase.costCode || phase.id;
}
