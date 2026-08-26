/** One-time migrate browser calculator values into projects.data.billing. */

import {
  defaultCalculatorLaborRates,
  normalizeCalculatorLaborRates,
} from "./manpowerCalculator";
import type { ProjectBillingData } from "../types/projectBilling";
import {
  getMonthBilledAmount,
  getMonthMaterialCost,
  withCalculatorLaborRates,
  withMonthBilledAmount,
  withMonthMaterialCost,
} from "../types/projectBilling";

const STORAGE_PREFIX = "jobflow.manpowerCalc";

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function laborRatesKey(projectId: string): string {
  return `${STORAGE_PREFIX}.${projectId}.laborRates`;
}

function clearLocalCalculator(projectId: string): void {
  try {
    const prefix = `${STORAGE_PREFIX}.${projectId}.`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function hasOnlyDefaultRates(billing: ProjectBillingData): boolean {
  const defaults = defaultCalculatorLaborRates();
  if (billing.calculatorLaborRates.length !== defaults.length) return false;
  const r = billing.calculatorLaborRates[0];
  const d = defaults[0];
  return Boolean(r && d && r.className === d.className && r.costRate === d.costRate);
}

/**
 * Copy localStorage calculator values into billing when DB fields are empty, then clear local keys.
 */
export function migrateLocalCalculatorIntoBilling(
  projectId: string,
  billing: ProjectBillingData,
): { billing: ProjectBillingData; changed: boolean } {
  if (typeof localStorage === "undefined") {
    return { billing, changed: false };
  }

  let next = billing;
  let changed = false;
  const prefix = `${STORAGE_PREFIX}.${projectId}.`;
  let hadLocal = false;

  try {
    const ratesRaw = localStorage.getItem(laborRatesKey(projectId));
    if (ratesRaw) {
      hadLocal = true;
      const rates = normalizeCalculatorLaborRates(JSON.parse(ratesRaw));
      if (rates.length && hasOnlyDefaultRates(next)) {
        next = withCalculatorLaborRates(next, rates);
        changed = true;
      }
    }

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      hadLocal = true;

      const monthsMatch = key.match(/\.months\.(\d{4}-\d{2})$/);
      if (monthsMatch) {
        const monthKey = monthsMatch[1]!;
        if (getMonthMaterialCost(next, monthKey) > 0) continue;
        try {
          const o = JSON.parse(localStorage.getItem(key) ?? "") as Record<string, unknown>;
          const amount = num(o.materialCost);
          if (amount > 0) {
            next = withMonthMaterialCost(next, monthKey, amount);
            changed = true;
          }
        } catch {
          /* ignore */
        }
        continue;
      }

      const billedMatch = key.match(/\.billed\.([^.]+)\.(\d{4}-\d{2})$/);
      if (billedMatch) {
        const contract = billedMatch[1]!;
        const monthKey = billedMatch[2]!;
        if (getMonthBilledAmount(next, contract, monthKey) > 0) continue;
        try {
          const o = JSON.parse(localStorage.getItem(key) ?? "") as Record<string, unknown>;
          const amount = num(o.billedAmount ?? o.amount);
          if (amount > 0) {
            next = withMonthBilledAmount(next, contract, monthKey, amount);
            changed = true;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return { billing: next, changed };
  }

  if (hadLocal) clearLocalCalculator(projectId);
  return { billing: next, changed };
}
