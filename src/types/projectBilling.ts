/**
 * Project billing data — stored in projects.data.billing, following the same
 * pattern as startup_items / trade documents (plain JSON blob, normalized on read).
 */

export type LaborRate = {
  id: string;
  className: string;
  costRate: number;
  billRate: number;
  /** Crew mix weight (relative headcount); used for blended averages. */
  crewMix: number;
};

export type BillingCostRow = {
  id: string;
  date: string;
  vendor: string;
  note: string;
  amount: number;
};

export type BillingPeriod = {
  id: string;
  periodLabel: string;
  billedAmount: number;
  retentionAmount: number;
  note: string;
};

export type BillingContract = {
  baseAmount: number;
  /** Approved COR / change-order line items; revised contract = base + sum(amount). */
  changes: BillingLineItem[];
  note: string;
};

export type BillingLineItem = {
  id: string;
  label: string;
  amount: number;
};

export const MANPOWER_PHASE_DEFS = [
  { id: "prime", name: "Prime / 1st coat" },
  { id: "final", name: "Final coat" },
  { id: "punch", name: "Touch-up / punch" },
] as const;

export type ManpowerPhaseId = (typeof MANPOWER_PHASE_DEFS)[number]["id"];

export type ManpowerPhase = {
  id: ManpowerPhaseId;
  name: string;
  budgetHours: number;
  actualHours: number;
};

export type ManpowerCell = {
  phaseId: ManpowerPhaseId;
  weekStartIso: string;
  /** Planned labor hours for this phase during this week. */
  hours: number;
};

export type ManpowerPeriodActual = {
  phaseId: ManpowerPhaseId;
  /** YYYY-MM for monthly actuals, YYYY-MM-DD (Monday) for weekly. */
  periodKey: string;
  actualHours: number;
};

export type WeeklyBudgetEntry = {
  weekStartIso: string;
  materialCost: number;
  materialBillable: number;
};

export type ProjectBillingData = {
  version: 1;
  contract: BillingContract;
  laborRates: LaborRate[];
  materialCosts: BillingCostRow[];
  otherCosts: BillingCostRow[];
  /** Simple cost-budget line items (label + amount). */
  budgetLines: BillingLineItem[];
  billingPeriods: BillingPeriod[];
  manpowerPhases: ManpowerPhase[];
  manpowerCells: ManpowerCell[];
  /** PM-entered actual hours by billing period (month or week). */
  manpowerPeriodActuals: ManpowerPeriodActual[];
  /** Weekly material plan for budget tracking; labor is derived from manpower hours and rates. */
  weeklyBudgetEntries: WeeklyBudgetEntry[];
  /** Number of week columns seeded from project start (default 8); add-week increments. */
  manpowerWeekCount: number;
};

export const BILLING_DATA_KEY = "billing" as const;

export const HOURS_PER_MAN_WEEK = 40;

export const PHASE_COLORS: Record<ManpowerPhaseId, { bg: string; border: string; text: string }> = {
  prime: { bg: "rgba(167, 139, 250, 0.22)", border: "#a78bfa", text: "#c4b5fd" },
  final: { bg: "rgba(79, 140, 255, 0.2)", border: "#4f8cff", text: "#9ec0ff" },
  punch: { bg: "rgba(45, 212, 191, 0.18)", border: "#2dd4bf", text: "#5eead4" },
};

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function newLaborRateId(): string {
  return newId("rate");
}

export function newCostRowId(): string {
  return newId("cost");
}

export function newBillingPeriodId(): string {
  return newId("period");
}

export function newBillingLineItemId(): string {
  return newId("line");
}

/** Company default labor classes; new projects copy these. */
export function defaultLaborRates(): LaborRate[] {
  return [
    { id: newLaborRateId(), className: "Foreman", costRate: 55, billRate: 95, crewMix: 1 },
    { id: newLaborRateId(), className: "Journeyman", costRate: 45, billRate: 80, crewMix: 2 },
    { id: newLaborRateId(), className: "Apprentice", costRate: 30, billRate: 55, crewMix: 1 },
  ];
}

export function defaultManpowerPhases(): ManpowerPhase[] {
  return MANPOWER_PHASE_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    budgetHours: 0,
    actualHours: 0,
  }));
}

export function defaultProjectBilling(seedLaborRates?: LaborRate[]): ProjectBillingData {
  return {
    version: 1,
    contract: { baseAmount: 0, changes: [], note: "" },
    laborRates: (seedLaborRates ?? defaultLaborRates()).map((r) => ({ ...r, id: newLaborRateId() })),
    materialCosts: [],
    otherCosts: [],
    budgetLines: [],
    billingPeriods: [],
    manpowerPhases: defaultManpowerPhases(),
    manpowerCells: [],
    manpowerPeriodActuals: [],
    weeklyBudgetEntries: [],
    manpowerWeekCount: 8,
  };
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeLaborRate(raw: unknown): LaborRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const className = str(o.className).trim();
  return {
    id: str(o.id).trim() || newLaborRateId(),
    className,
    costRate: num(o.costRate),
    billRate: num(o.billRate),
    crewMix: num(o.crewMix),
  };
}

export function normalizeLaborRates(raw: unknown): LaborRate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeLaborRate).filter((r): r is LaborRate => Boolean(r));
}

function normalizeCostRow(raw: unknown): BillingCostRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    id: str(o.id).trim() || newCostRowId(),
    date: str(o.date),
    vendor: str(o.vendor),
    note: str(o.note),
    amount: num(o.amount),
  };
}

function normalizeCostRows(raw: unknown): BillingCostRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCostRow).filter((r): r is BillingCostRow => Boolean(r));
}

function normalizeBillingPeriod(raw: unknown): BillingPeriod | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    id: str(o.id).trim() || newBillingPeriodId(),
    periodLabel: str(o.periodLabel),
    billedAmount: num(o.billedAmount),
    retentionAmount: num(o.retentionAmount),
    note: str(o.note),
  };
}

function normalizeBillingLineItem(raw: unknown): BillingLineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = str(o.label).trim();
  const amount = num(o.amount);
  if (!label && amount <= 0) return null;
  return {
    id: str(o.id).trim() || newBillingLineItemId(),
    label,
    amount,
  };
}

function normalizeBillingLineItems(raw: unknown): BillingLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBillingLineItem).filter((r): r is BillingLineItem => Boolean(r));
}

function migrateLegacyBudgetLines(budgetsRaw: Record<string, unknown>): BillingLineItem[] {
  const lines: BillingLineItem[] = [];
  const material = num(budgetsRaw.materialBudget);
  const other = num(budgetsRaw.otherBudget);
  const laborHours = num(budgetsRaw.laborBudgetHours);
  if (material > 0) lines.push({ id: newBillingLineItemId(), label: "Material", amount: material });
  if (other > 0) lines.push({ id: newBillingLineItemId(), label: "Other", amount: other });
  if (laborHours > 0) lines.push({ id: newBillingLineItemId(), label: "Labor (hours ref)", amount: laborHours });
  return lines;
}

function migrateLegacyContractChanges(contractRaw: Record<string, unknown>): BillingLineItem[] {
  const fromArray = normalizeBillingLineItems(contractRaw.changes);
  if (fromArray.length) return fromArray;
  const legacy = num(contractRaw.approvedChanges);
  if (legacy > 0) {
    return [{ id: newBillingLineItemId(), label: "Approved changes", amount: legacy }];
  }
  return [];
}

function normalizeBillingPeriods(raw: unknown): BillingPeriod[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBillingPeriod).filter((r): r is BillingPeriod => Boolean(r));
}

function normalizeBudgetLines(raw: unknown, budgetsRaw: Record<string, unknown>): BillingLineItem[] {
  const lines = normalizeBillingLineItems(raw);
  if (lines.length) return lines;
  return migrateLegacyBudgetLines(budgetsRaw);
}

const MANPOWER_PHASE_IDS = new Set<string>(MANPOWER_PHASE_DEFS.map((d) => d.id));

function normalizeManpowerPhase(raw: unknown, def: (typeof MANPOWER_PHASE_DEFS)[number]): ManpowerPhase {
  if (!raw || typeof raw !== "object") {
    return { id: def.id, name: def.name, budgetHours: 0, actualHours: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    id: def.id,
    name: def.name,
    budgetHours: num(o.budgetHours),
    actualHours: num(o.actualHours),
  };
}

function normalizeManpowerPhases(raw: unknown): ManpowerPhase[] {
  const byId = new Map<ManpowerPhaseId, ManpowerPhase>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const id = str((item as Record<string, unknown>).id).trim();
      const def = MANPOWER_PHASE_DEFS.find((d) => d.id === id);
      if (def) byId.set(def.id, normalizeManpowerPhase(item, def));
    }
  }
  return MANPOWER_PHASE_DEFS.map((def) => byId.get(def.id) ?? normalizeManpowerPhase(null, def));
}

function normalizeManpowerCell(raw: unknown): ManpowerCell | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phaseId = str(o.phaseId).trim();
  if (!MANPOWER_PHASE_IDS.has(phaseId)) return null;
  const weekStartIso = str(o.weekStartIso).trim();
  if (!weekStartIso) return null;
  // Legacy cells stored whole-crew counts; convert to hours (crew × 40).
  const hours = o.hours !== undefined ? num(o.hours) : num(o.crewCount) * HOURS_PER_MAN_WEEK;
  if (hours <= 0) return null;
  return { phaseId: phaseId as ManpowerPhaseId, weekStartIso, hours };
}

function normalizeManpowerCells(raw: unknown): ManpowerCell[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeManpowerCell).filter((r): r is ManpowerCell => Boolean(r));
}

function normalizeManpowerPeriodActual(raw: unknown): ManpowerPeriodActual | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phaseId = str(o.phaseId).trim();
  if (!MANPOWER_PHASE_IDS.has(phaseId)) return null;
  const periodKey = str(o.periodKey).trim();
  if (!periodKey) return null;
  const actualHours = num(o.actualHours);
  if (actualHours <= 0) return null;
  return { phaseId: phaseId as ManpowerPhaseId, periodKey, actualHours };
}

function normalizeManpowerPeriodActuals(raw: unknown): ManpowerPeriodActual[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeManpowerPeriodActual).filter((r): r is ManpowerPeriodActual => Boolean(r));
}

function normalizeWeeklyBudgetEntry(raw: unknown): WeeklyBudgetEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const weekStartIso = str(o.weekStartIso).trim();
  if (!weekStartIso) return null;
  const materialCost = num(o.materialCost);
  const materialBillable = num(o.materialBillable);
  if (materialCost <= 0 && materialBillable <= 0) return null;
  return { weekStartIso, materialCost, materialBillable };
}

function normalizeWeeklyBudgetEntries(raw: unknown): WeeklyBudgetEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeWeeklyBudgetEntry).filter((r): r is WeeklyBudgetEntry => Boolean(r));
}

export function normalizeProjectBilling(raw: unknown, seedLaborRates?: LaborRate[]): ProjectBillingData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultProjectBilling(seedLaborRates);
  }
  const o = raw as Record<string, unknown>;
  const contractRaw =
    o.contract && typeof o.contract === "object" ? (o.contract as Record<string, unknown>) : {};
  const budgetsRaw =
    o.budgets && typeof o.budgets === "object" ? (o.budgets as Record<string, unknown>) : {};
  const laborRates = normalizeLaborRates(o.laborRates);

  return {
    version: 1,
    contract: {
      baseAmount: num(contractRaw.baseAmount),
      changes: migrateLegacyContractChanges(contractRaw),
      note: str(contractRaw.note),
    },
    laborRates: laborRates.length ? laborRates : defaultProjectBilling(seedLaborRates).laborRates,
    materialCosts: normalizeCostRows(o.materialCosts),
    otherCosts: normalizeCostRows(o.otherCosts),
    budgetLines: normalizeBudgetLines(o.budgetLines, budgetsRaw),
    billingPeriods: normalizeBillingPeriods(o.billingPeriods),
    manpowerPhases: normalizeManpowerPhases(o.manpowerPhases),
    manpowerCells: normalizeManpowerCells(o.manpowerCells),
    manpowerPeriodActuals: normalizeManpowerPeriodActuals(o.manpowerPeriodActuals),
    weeklyBudgetEntries: normalizeWeeklyBudgetEntries(o.weeklyBudgetEntries),
    manpowerWeekCount: Math.max(1, Math.round(num(o.manpowerWeekCount, 8)) || 8),
  };
}

export function parseProjectBilling(projectData: unknown, seedLaborRates?: LaborRate[]): ProjectBillingData {
  const blob =
    projectData && typeof projectData === "object" && !Array.isArray(projectData)
      ? (projectData as Record<string, unknown>)
      : {};
  return normalizeProjectBilling(blob[BILLING_DATA_KEY], seedLaborRates);
}

/* ---------- Manpower derivations ---------- */

export function phaseBudgetShare(phase: ManpowerPhase, phases: ManpowerPhase[]): number {
  const total = phases.reduce((sum, p) => sum + p.budgetHours, 0);
  if (total <= 0) return 0;
  return phase.budgetHours / total;
}

export function plannedHoursForPhase(phaseId: ManpowerPhaseId, cells: ManpowerCell[]): number {
  return cells.filter((c) => c.phaseId === phaseId).reduce((sum, c) => sum + c.hours, 0);
}

export function actualHoursForPeriod(
  periodActuals: ManpowerPeriodActual[],
  phaseId: ManpowerPhaseId,
  periodKey: string,
): number {
  return (
    periodActuals.find((a) => a.phaseId === phaseId && a.periodKey === periodKey)?.actualHours ?? 0
  );
}

export function withPeriodActual(
  periodActuals: ManpowerPeriodActual[],
  phaseId: ManpowerPhaseId,
  periodKey: string,
  actualHours: number,
): ManpowerPeriodActual[] {
  const next = periodActuals.filter((a) => !(a.phaseId === phaseId && a.periodKey === periodKey));
  if (actualHours > 0) next.push({ phaseId, periodKey, actualHours });
  return next;
}

export function phaseActualHours(phase: ManpowerPhase, periodActuals: ManpowerPeriodActual[]): number {
  const fromPeriods = periodActuals
    .filter((a) => a.phaseId === phase.id)
    .reduce((sum, a) => sum + a.actualHours, 0);
  if (periodActuals.some((a) => a.phaseId === phase.id)) return fromPeriods;
  return phase.actualHours;
}

export function syncPhaseActualTotals(
  phases: ManpowerPhase[],
  periodActuals: ManpowerPeriodActual[],
): ManpowerPhase[] {
  return phases.map((p) => ({
    ...p,
    actualHours: periodActuals.filter((a) => a.phaseId === p.id).reduce((sum, a) => sum + a.actualHours, 0),
  }));
}

export function weeklyBudgetEntry(
  entries: WeeklyBudgetEntry[],
  weekStartIso: string,
): WeeklyBudgetEntry {
  return (
    entries.find((b) => b.weekStartIso === weekStartIso) ?? {
      weekStartIso,
      materialCost: 0,
      materialBillable: 0,
    }
  );
}

export function withWeeklyBudgetEntry(
  entries: WeeklyBudgetEntry[],
  weekStartIso: string,
  patch: Partial<Pick<WeeklyBudgetEntry, "materialCost" | "materialBillable">>,
): WeeklyBudgetEntry[] {
  const merged = { ...weeklyBudgetEntry(entries, weekStartIso), ...patch, weekStartIso };
  const next = entries.filter((b) => b.weekStartIso !== weekStartIso);
  if (merged.materialCost > 0 || merged.materialBillable > 0) next.push(merged);
  return next;
}

export function weeklyMaterialTotals(entries: WeeklyBudgetEntry[]): { cost: number; billable: number } {
  return entries.reduce(
    (acc, b) => ({ cost: acc.cost + b.materialCost, billable: acc.billable + b.materialBillable }),
    { cost: 0, billable: 0 },
  );
}

export function totalPlannedHours(billing: ProjectBillingData): number {
  return MANPOWER_PHASE_DEFS.reduce(
    (sum, def) => sum + plannedHoursForPhase(def.id, billing.manpowerCells),
    0,
  );
}

export function totalActualHours(billing: ProjectBillingData): number {
  return billing.manpowerPhases.reduce(
    (sum, p) => sum + phaseActualHours(p, billing.manpowerPeriodActuals),
    0,
  );
}

export function earnedPct(billing: ProjectBillingData): number {
  const phases = billing.manpowerPhases;
  const totalBudget = phases.reduce((sum, p) => sum + p.budgetHours, 0);
  if (totalBudget <= 0) return 0;
  return phases.reduce((sum, p) => {
    const share = p.budgetHours / totalBudget;
    const actual = phaseActualHours(p, billing.manpowerPeriodActuals);
    const progress = p.budgetHours > 0 ? Math.min(actual / p.budgetHours, 1) : 0;
    return sum + share * progress;
  }, 0);
}

export function projectedLaborHours(billing: ProjectBillingData): number {
  return totalPlannedHours(billing);
}

export function projectedLaborCost(billing: ProjectBillingData): number {
  return projectedLaborHours(billing) * blendedCostRate(billing.laborRates);
}

/* ---------- Cost derivations (never stored) ---------- */

export function blendedCostRate(rates: LaborRate[]): number {
  const totalMix = rates.reduce((sum, r) => sum + r.crewMix, 0);
  if (totalMix <= 0) return 0;
  return rates.reduce((sum, r) => sum + r.costRate * r.crewMix, 0) / totalMix;
}

export function blendedBillRate(rates: LaborRate[]): number {
  const totalMix = rates.reduce((sum, r) => sum + r.crewMix, 0);
  if (totalMix <= 0) return 0;
  return rates.reduce((sum, r) => sum + r.billRate * r.crewMix, 0) / totalMix;
}

export function lineItemsTotal(items: BillingLineItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

export function revisedContract(contract: BillingContract): number {
  return contract.baseAmount + lineItemsTotal(contract.changes);
}

export function costRowsTotal(rows: BillingCostRow[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

export function billedToDate(periods: BillingPeriod[]): number {
  return periods.reduce((sum, p) => sum + p.billedAmount, 0);
}

export function retentionHeldToDate(periods: BillingPeriod[]): number {
  return periods.reduce((sum, p) => sum + p.retentionAmount, 0);
}

/** Labor-to-date = totalActualHours × blendedCostRate. */
export function laborCostToDate(billing: ProjectBillingData): number {
  return totalActualHours(billing) * blendedCostRate(billing.laborRates);
}

export function costToDate(billing: ProjectBillingData): number {
  return (
    laborCostToDate(billing) +
    costRowsTotal(billing.materialCosts) +
    costRowsTotal(billing.otherCosts)
  );
}

/**
 * Projected total = projected labor + best available material projection + other projection.
 * Material actuals remain in materialCosts; weekly material entries are plan/projection only.
 */
export function projectedTotalCost(billing: ProjectBillingData): number {
  const weeklyMaterialPlan = weeklyMaterialTotals(billing.weeklyBudgetEntries).cost;
  const derived =
    projectedLaborCost(billing) +
    Math.max(costRowsTotal(billing.materialCosts), weeklyMaterialPlan) +
    costRowsTotal(billing.otherCosts);
  const budgetTotal = lineItemsTotal(billing.budgetLines);
  return budgetTotal > 0 ? Math.max(derived, budgetTotal) : derived;
}

/** @deprecated use projectedTotalCost */
export function projectedCost(billing: ProjectBillingData): number {
  return projectedTotalCost(billing);
}

export function projectedMarginDollars(billing: ProjectBillingData): number | null {
  const revised = revisedContract(billing.contract);
  if (revised <= 0) return null;
  return revised - projectedTotalCost(billing);
}

export function projectedMarginPct(billing: ProjectBillingData): number | null {
  const revised = revisedContract(billing.contract);
  if (revised <= 0) return null;
  return (revised - projectedTotalCost(billing)) / revised;
}

export function billedPct(billing: ProjectBillingData): number | null {
  const revised = revisedContract(billing.contract);
  if (revised <= 0) return null;
  return billedToDate(billing.billingPeriods) / revised;
}

export type EarnedVsBilled = {
  earnedPct: number;
  billedPct: number | null;
  underbilledAmount: number;
  isUnderbilled: boolean;
};

export function earnedVsBilled(billing: ProjectBillingData): EarnedVsBilled {
  const earned = earnedPct(billing);
  const billed = billedPct(billing);
  const revised = revisedContract(billing.contract);
  const underbilledAmount = billed !== null && revised > 0 ? (earned - billed) * revised : 0;
  return {
    earnedPct: earned,
    billedPct: billed,
    underbilledAmount,
    isUnderbilled: billed !== null && earned > billed,
  };
}

export function formatMoney0(value: number): string {
  return `$${Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatPct0(value: number): string {
  return `${Math.round(value * 100)}%`;
}
