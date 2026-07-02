import {
  optionalStepLabel,
  PROJECT_STARTUP_OPTIONAL_STEPS,
} from "../config/projectStartupOptionalSteps";

export type StartupOptionalCustomStep = {
  id: string;
  label: string;
};

export type StartupOptionalState = {
  /** Catalog step ids enabled for this project */
  enabled: string[];
  /** User-added steps (label only; id generated on add) */
  custom: StartupOptionalCustomStep[];
  /** Completion by step id (catalog or custom) */
  checked: Record<string, boolean>;
};

export function defaultStartupOptional(): StartupOptionalState {
  return { enabled: [], custom: [], checked: {} };
}

export function parseStartupOptional(raw: unknown): StartupOptionalState {
  const base = defaultStartupOptional();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  const catalogIds = new Set<string>(PROJECT_STARTUP_OPTIONAL_STEPS.map((s) => s.id));
  const enabled = Array.isArray(o.enabled)
    ? o.enabled.filter((id): id is string => typeof id === "string" && catalogIds.has(id))
    : [];

  const custom: StartupOptionalCustomStep[] = [];
  if (Array.isArray(o.custom)) {
    for (const row of o.custom) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      const label = typeof r.label === "string" ? r.label.trim() : "";
      if (id && label) custom.push({ id, label });
    }
  }

  const checked: Record<string, boolean> = {};
  if (o.checked && typeof o.checked === "object" && !Array.isArray(o.checked)) {
    for (const [key, val] of Object.entries(o.checked as Record<string, unknown>)) {
      if (typeof val === "boolean") checked[key] = val;
    }
  }

  return { enabled, custom, checked };
}

export function activeOptionalSteps(state: StartupOptionalState): { id: string; label: string }[] {
  const rows: { id: string; label: string }[] = [];
  for (const id of state.enabled) {
    rows.push({ id, label: optionalStepLabel(id, state.custom) });
  }
  for (const row of state.custom) {
    rows.push({ id: row.id, label: row.label });
  }
  return rows;
}

export function optionalStartupProgress(state: StartupOptionalState): {
  done: number;
  total: number;
} {
  const steps = activeOptionalSteps(state);
  const done = steps.filter((s) => state.checked[s.id]).length;
  return { done, total: steps.length };
}

export function newCustomOptionalStepId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return `custom_${slug || "task"}_${crypto.randomUUID().slice(0, 8)}`;
}
