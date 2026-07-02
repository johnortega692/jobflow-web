import { loadOrgSettingsBlob, saveOrgSettingsPatch } from "./orgSettings";
import { defaultLaborRates, normalizeLaborRates, type LaborRate } from "../types/projectBilling";

export const COMPANY_LABOR_RATES_KEY = "company_labor_rates";

/** Company default labor rates; new projects copy from these. Falls back to seed defaults. */
export async function loadCompanyLaborRates(): Promise<LaborRate[]> {
  const org = await loadOrgSettingsBlob();
  const rates = normalizeLaborRates(org[COMPANY_LABOR_RATES_KEY]);
  return rates.length ? rates : defaultLaborRates();
}

export async function saveCompanyLaborRates(rates: LaborRate[], userId: string): Promise<string | null> {
  const cleaned = rates.filter((r) => r.className.trim());
  return saveOrgSettingsPatch({ [COMPANY_LABOR_RATES_KEY]: cleaned }, userId);
}
