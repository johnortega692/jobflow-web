import { useEffect, useRef, useState } from "react";
import type { CarryDest } from "../../lib/carryOver";

export type CarryWeekRow = {
  phaseId: string;
  code: string;
  name: string;
  planned: number;
};

type Props = {
  weekLabel: string;
  nextWeekLabel: string | null;
  isLastWeek: boolean;
  rows: CarryWeekRow[];
  saving: boolean;
  onCancel: () => void;
  onApply: (actuals: { phaseId: string; actual: number }[], dest: CarryDest) => void;
};

function formatQty(hours: number): string {
  if (!Number.isFinite(hours)) return "0";
  const rounded = Math.round(hours * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function parseActual(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function CarryWeekSheet({
  weekLabel,
  nextWeekLabel,
  isLastWeek,
  rows,
  saving,
  onCancel,
  onApply,
}: Props) {
  const [text, setText] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of rows) initial[row.phaseId] = formatQty(row.planned);
    return initial;
  });
  const [dest, setDest] = useState<CarryDest>(isLastWeek ? "park" : "next");

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const parsed = rows.map((row) => {
    const actual = parseActual(text[row.phaseId] ?? "");
    const shortfall = actual === null ? 0 : Math.max(0, row.planned - actual);
    return { ...row, actual, shortfall };
  });
  const invalid = parsed.some((row) => row.actual === null);
  const totalShort = parsed.reduce((sum, row) => sum + row.shortfall, 0);

  return (
    <div className="carry-sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="carry-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="carry-week-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="carry-week-title">Week of {weekLabel}</h2>
        <p className="muted carry-sheet-sub">Enter hours actually worked. Any shortfall can be carried.</p>

        {rows.length === 0 ? (
          <p className="muted small">No planned hours this week.</p>
        ) : (
          <ul className="carry-sheet-rows">
            {parsed.map((row) => (
              <li key={row.phaseId}>
                <div className="carry-sheet-row">
                  <div className="carry-sheet-code">
                    <strong>{row.code}</strong>
                    {row.name ? <span>{row.name}</span> : null}
                  </div>
                  <div className="carry-sheet-planned">
                    <span className="muted small">Planned</span>
                    <strong>{formatQty(row.planned)}</strong>
                  </div>
                  <label className="carry-sheet-actual">
                    <span className="muted small">Actual</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={text[row.phaseId] ?? ""}
                      onChange={(event) =>
                        setText((current) => ({ ...current, [row.phaseId]: event.target.value }))
                      }
                    />
                  </label>
                </div>
                {row.actual !== null && row.actual < row.planned ? (
                  <p className="carry-sheet-short">short {formatQty(row.shortfall)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {totalShort > 0 ? (
          <fieldset className="carry-sheet-dest">
            <legend>Carry {formatQty(totalShort)} hrs to:</legend>
            <label>
              <input
                type="radio"
                name="carry-dest"
                checked={dest === "next"}
                disabled={isLastWeek}
                onChange={() => setDest("next")}
              />
              Next week{nextWeekLabel ? ` (${nextWeekLabel})` : ""}
            </label>
            <label>
              <input
                type="radio"
                name="carry-dest"
                checked={dest === "spread"}
                onChange={() => setDest("spread")}
              />
              Remaining weeks
            </label>
            <label>
              <input
                type="radio"
                name="carry-dest"
                checked={dest === "park"}
                onChange={() => setDest("park")}
              />
              Park in tray
            </label>
          </fieldset>
        ) : null}

        <div className="carry-sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || invalid || rows.length === 0 || (dest === "next" && isLastWeek)}
            onClick={() => {
              if (invalid) return;
              onApply(
                parsed.map((row) => ({ phaseId: row.phaseId, actual: row.actual ?? 0 })),
                dest,
              );
            }}
          >
            {totalShort > 0 ? "Apply & carry" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
