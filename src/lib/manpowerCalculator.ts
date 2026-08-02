/** Session-only manpower cost calculator — localStorage, not project billing. */

export type CalculatorLaborRate = {
  id: string;
  className: string;
  costRate: number;
};

export type MonthCalculatorMaterial = {
  materialCost: number;
};

export type MonthCalculatorTotals = {
  laborCost: number;
  materialCost: number;
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
  return [{ id: newCalculatorLaborRateId(), className: "Journeyman", costRate: 45 }];
}

function normalizeRate(raw: unknown): CalculatorLaborRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const className = typeof o.className === "string" ? o.className.trim() : "";
  const costRate = num(o.costRate);
  return {
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : newCalculatorLaborRateId(),
    className,
    costRate,
  };
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

export function blendedCostRate(rates: CalculatorLaborRate[]): number {
  if (rates.length === 0) return 0;
  return rates.reduce((sum, r) => sum + r.costRate, 0) / rates.length;
}

/** Hours-based % complete (0–100). */
export function hoursPercentComplete(cumulativeHours: number, totalHours: number): number {
  if (totalHours <= 0) return 0;
  return (cumulativeHours / totalHours) * 100;
}

/** Contract value earned at a given hours % complete. */
export function pocBillableAmount(contractValue: number, percentComplete: number): number {
  if (contractValue <= 0 || percentComplete <= 0) return 0;
  return contractValue * (percentComplete / 100);
}

/** Month's earned billable = change in cumulative POC billable. */
export function monthPocBillable(
  contractValue: number,
  prevCumulativeHours: number,
  cumulativeHours: number,
  totalHours: number,
): number {
  if (contractValue <= 0 || totalHours <= 0) return 0;
  const prev = pocBillableAmount(contractValue, hoursPercentComplete(prevCumulativeHours, totalHours));
  const next = pocBillableAmount(contractValue, hoursPercentComplete(cumulativeHours, totalHours));
  return Math.max(0, next - prev);
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
    if (!raw) return { materialCost: 0 };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return { materialCost: num(o.materialCost) };
  } catch {
    return { materialCost: 0 };
  }
}

export function saveMonthMaterial(projectId: string, monthKey: string, material: MonthCalculatorMaterial): void {
  localStorage.setItem(
    monthMaterialKey(projectId, monthKey),
    JSON.stringify({
      materialCost: num(material.materialCost),
    }),
  );
}

export function deriveMonthCalculatorTotals(
  hours: number,
  rates: CalculatorLaborRate[],
  materialCost: number,
  pocBillable: number,
): MonthCalculatorTotals {
  const laborCost = hours * blendedCostRate(rates);
  const material = num(materialCost);
  const cost = laborCost + material;
  const billable = num(pocBillable);
  return {
    laborCost,
    materialCost: material,
    cost,
    billable,
    margin: billable - cost,
  };
}
