import type { AhaProb, AhaSev, AhaStep, RacLevel } from "./types";

/**
 * EM 385-1-1 risk assessment code.
 * Severity rows: C catastrophic, R critical, M marginal, N negligible.
 * Probability columns: F frequent, L likely, O occasional, S seldom, U unlikely.
 */
const RAC_MATRIX: Record<AhaSev, Record<AhaProb, RacLevel>> = {
  C: { F: "E", L: "E", O: "H", S: "H", U: "M" },
  R: { F: "E", L: "H", O: "H", S: "M", U: "L" },
  M: { F: "H", L: "M", O: "M", S: "L", U: "L" },
  N: { F: "M", L: "L", O: "L", S: "L", U: "L" },
};

const RAC_RANK: Record<RacLevel, number> = { L: 0, M: 1, H: 2, E: 3 };

export function racFor(prob: AhaProb, sev: AhaSev): RacLevel {
  return RAC_MATRIX[sev][prob];
}

/** Highest RAC on the sheet. Empty step lists are Low. */
export function overallRac(steps: Pick<AhaStep, "prob" | "sev">[]): RacLevel {
  let best: RacLevel = "L";
  for (const step of steps) {
    const rac = racFor(step.prob, step.sev);
    if (RAC_RANK[rac] > RAC_RANK[best]) best = rac;
  }
  return best;
}

export const RAC_COLORS: Record<RacLevel, { background: string; color: string }> = {
  E: { background: "#b42318", color: "#ffffff" },
  H: { background: "#c2410c", color: "#ffffff" },
  M: { background: "#eab308", color: "#1a1a1a" },
  L: { background: "#2f7d4a", color: "#ffffff" },
};

/** Job-scoped AHA number, same style as PO numbers (`24100-01`). */
export function ahaNumber(jobNumber: string, seq: number): string {
  return `${jobNumber}-${String(seq).padStart(2, "0")}`;
}
