/** Default labor rates — aligned with desktop Work Order Manager. */

export type LaborRateOption = {
  name: string;
  billing_rate: number;
  raw_cost_per_hour: number;
};

export const DEFAULT_LABOR_RATES: LaborRateOption[] = [
  { name: "Journeyman Reg", billing_rate: 129.61, raw_cost_per_hour: 65 },
  { name: "Journeyman 1.5", billing_rate: 165.05, raw_cost_per_hour: 72 },
  { name: "Journeyman DD", billing_rate: 205.1, raw_cost_per_hour: 85 },
  { name: "Forman Reg", billing_rate: 140.6, raw_cost_per_hour: 96 },
  { name: "Forman 1.5", billing_rate: 176.05, raw_cost_per_hour: 105 },
  { name: "Forman DD", billing_rate: 216.1, raw_cost_per_hour: 110 },
  { name: "Budget Rate 1", billing_rate: 96, raw_cost_per_hour: 65 },
  { name: "Budget Rate 2", billing_rate: 91, raw_cost_per_hour: 65 },
];

export const DEFAULT_RAW_COST_RATES = [65, 72, 85, 96, 105, 110, 120, 150] as const;
