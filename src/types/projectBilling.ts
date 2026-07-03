/**
 * Project manpower plan — stored in projects.data.billing (hours only).
 */

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

/** Hours-only manpower plan persisted per project. */
export type ProjectBillingData = {
  version: 1;
  manpowerPhases: ManpowerPhase[];
  manpowerCells: ManpowerCell[];
  manpowerPeriodActuals: ManpowerPeriodActual[];
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

export function defaultManpowerPhases(): ManpowerPhase[] {
  return MANPOWER_PHASE_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    budgetHours: 0,
    actualHours: 0,
  }));
}

export function defaultProjectBilling(): ProjectBillingData {
  return {
    version: 1,
    manpowerPhases: defaultManpowerPhases(),
    manpowerCells: [],
    manpowerPeriodActuals: [],
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

export function normalizeProjectBilling(raw: unknown): ProjectBillingData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultProjectBilling();
  }
  const o = raw as Record<string, unknown>;
  return {
    version: 1,
    manpowerPhases: normalizeManpowerPhases(o.manpowerPhases),
    manpowerCells: normalizeManpowerCells(o.manpowerCells),
    manpowerPeriodActuals: normalizeManpowerPeriodActuals(o.manpowerPeriodActuals),
    manpowerWeekCount: Math.max(1, Math.round(num(o.manpowerWeekCount, 8)) || 8),
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
