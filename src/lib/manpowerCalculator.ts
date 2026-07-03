/** Session-only manpower cost calculator — localStorage, not project billing. */

export type CalculatorLaborRate = {
  id: string;
  className: string;
  costRate: number;
  billRate: number;
  crewMix: number;
};

export type MonthCalculatorMaterial = {
  materialCost: number;
  materialBillable: number;
};

export type MonthCalculatorTotals = {
  laborCost: number;
  laborBillable: number;
  materialCost: number;
  materialBillable: number;
  cost: number;
  billable: number;
  margin: number;
};

const STORAGE_PREFIX = "jobflow.manpowerCalc";

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function newCalculatorLaborRateId(): string {
  return newId("rate");
}

export function defaultCalculatorLaborRates(): CalculatorLaborRate[] {
  return [
    { id: newCalculatorLaborRateId(), className: "Foreman", costRate: 55, billRate: 95, crewMix: 1 },
    { id: newCalculatorLaborRateId(), className: "Journeyman", costRate: 45, billRate: 80, crewMix: 2 },
    { id: newCalculatorLaborRateId(), className: "Apprentice", costRate: 30, billRate: 55, crewMix: 1 },
  ];
}

function normalizeRate(raw: unknown): CalculatorLaborRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const className = typeof o.className === "string" ? o.className.trim() : "";
  const costRate = num(o.costRate);
  const billRate = num(o.billRate);
  const crewMix = num(o.crewMix);
  return {
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : newCalculatorLaborRateId(),
    className,
    costRate,
    billRate,
    crewMix,
  };
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

export function blendedCostRate(rates: CalculatorLaborRate[]): number {
  const totalMix = rates.reduce((sum, r) => sum + r.crewMix, 0);
  if (totalMix <= 0) return 0;
  return rates.reduce((sum, r) => sum + r.costRate * r.crewMix, 0) / totalMix;
}

export function blendedBillRate(rates: CalculatorLaborRate[]): number {
  const totalMix = rates.reduce((sum, r) => sum + r.crewMix, 0);
  if (totalMix <= 0) return 0;
  return rates.reduce((sum, r) => sum + r.billRate * r.crewMix, 0) / totalMix;
}

export function formatMoney0(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatPct0(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

export function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function formatInputValue(value: number): string {
  return value > 0 ? String(Number(value.toFixed(2))) : "";
}

function laborRatesKey(projectId: string): string {
  return `${STORAGE_PREFIX}.${projectId}.laborRates`;
}

function monthMaterialKey(projectId: string, monthKey: string): string {
  return `${STORAGE_PREFIX}.${projectId}.months.${monthKey}`;
}

export function loadCalculatorLaborRates(projectId: string): CalculatorLaborRate[] {
  try {
    const raw = localStorage.getItem(laborRatesKey(projectId));
    if (!raw) return defaultCalculatorLaborRates();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultCalculatorLaborRates();
    const rates = parsed.map(normalizeRate).filter((r): r is CalculatorLaborRate => Boolean(r?.className));
    return rates.length ? rates : defaultCalculatorLaborRates();
  } catch {
    return defaultCalculatorLaborRates();
  }
}

export function saveCalculatorLaborRates(projectId: string, rates: CalculatorLaborRate[]): void {
  const cleaned = rates.filter((r) => r.className.trim());
  localStorage.setItem(laborRatesKey(projectId), JSON.stringify(cleaned.length ? cleaned : defaultCalculatorLaborRates()));
}

export function loadMonthMaterial(projectId: string, monthKey: string): MonthCalculatorMaterial {
  try {
    const raw = localStorage.getItem(monthMaterialKey(projectId, monthKey));
    if (!raw) return { materialCost: 0, materialBillable: 0 };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return { materialCost: num(o.materialCost), materialBillable: num(o.materialBillable) };
  } catch {
    return { materialCost: 0, materialBillable: 0 };
  }
}

export function saveMonthMaterial(projectId: string, monthKey: string, material: MonthCalculatorMaterial): void {
  localStorage.setItem(
    monthMaterialKey(projectId, monthKey),
    JSON.stringify({
      materialCost: num(material.materialCost),
      materialBillable: num(material.materialBillable),
    }),
  );
}

export function deriveMonthCalculatorTotals(
  hours: number,
  rates: CalculatorLaborRate[],
  material: MonthCalculatorMaterial,
): MonthCalculatorTotals {
  const costRate = blendedCostRate(rates);
  const billRate = blendedBillRate(rates);
  const laborCost = hours * costRate;
  const laborBillable = hours * billRate;
  const materialCost = num(material.materialCost);
  const materialBillable = num(material.materialBillable);
  const cost = laborCost + materialCost;
  const billable = laborBillable + materialBillable;
  return {
    laborCost,
    laborBillable,
    materialCost,
    materialBillable,
    cost,
    billable,
    margin: billable - cost,
  };
}

export function billableRatioFromRates(rates: CalculatorLaborRate[]): number {
  const costRate = blendedCostRate(rates);
  const billRate = blendedBillRate(rates);
  return costRate > 0 ? billRate / costRate : 1;
}
