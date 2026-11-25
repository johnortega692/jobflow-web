import { useEffect, useRef, useState } from "react";
import { FlagSwitch } from "../jobinfo/StageStepper";
import { DateInput } from "../DateInput";
import { toIsoDateValue } from "../../lib/dateInputUtils";
import { formatMoney0 } from "../../lib/manpowerCalculator";
import { weekColumnLabel, weekDayIsos } from "../../lib/manpowerCalendar";
import {
  blankRentalLine,
  callOffByIso,
  orderByIso,
  rentalIsConfirmed,
  rentalQuoteForLine,
  rentalReminders,
  rentalUnitWeeks,
  rentalWeekFill,
  RENTAL_STATUSES,
  RENTAL_STATUS_LABEL,
  type RentalStatus,
} from "../../lib/rentalEquipment";
import type { ProjectBillingData, RentalEquipment, RentalEquipmentCell } from "../../types/projectBilling";

type Props = {
  billing: ProjectBillingData;
  weeks: string[];
  canEdit: boolean;
  saving: boolean;
  onSave: (next: ProjectBillingData) => void;
};

type ShiftProps = {
  dayDelta: number;
  lines: RentalEquipment[];
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onApply: () => void;
};

function todayIso(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function rangeLabel(onRentIso: string, offRentIso: string): string {
  if (onRentIso && offRentIso) return `${shortDate(onRentIso)} to ${shortDate(offRentIso)}`;
  if (onRentIso) return `From ${shortDate(onRentIso)}`;
  if (offRentIso) return `Thru ${shortDate(offRentIso)}`;
  return "Set dates";
}

function menuColumns(weekCount: number): { gridTemplateColumns: string } {
  return {
    gridTemplateColumns: `minmax(9.25rem, 1.3fr) repeat(${Math.max(weekCount, 1)}, minmax(3.35rem, 1fr)) 3.5rem 4.7rem 5.6rem`,
  };
}

function parseRate(raw: string): number | null {
  const value = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

function weekOverridesFor(cells: RentalEquipmentCell[], equipmentId: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const cell of cells) {
    if (cell.equipmentId === equipmentId && !cell.dayIso) map.set(cell.weekStartIso, cell.quantity);
  }
  return map;
}


export function RentalShiftDialog({ dayDelta, lines, checked, onToggle, onCancel, onApply }: ShiftProps) {
  const weeks = Math.max(1, Math.round(Math.abs(dayDelta) / 7));
  const direction = dayDelta > 0 ? "later" : "earlier";
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal card stack billing-rental-shift"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rental-shift-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rental-shift-title">Shift rental equipment?</h2>
        <p className="muted small">
          Labor moved {weeks} week{weeks === 1 ? "" : "s"} {direction}. Shift the checked rentals by the same amount.
          Confirmed orders stay on their dates unless you check them.
        </p>
        <ul className="billing-rental-shift-list">
          {lines.map((line) => (
            <li key={line.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.has(line.id)}
                  onChange={() => onToggle(line.id)}
                />
                <span>
                  {line.name.trim() || "Untitled equipment"}
                  {" · "}
                  {RENTAL_STATUS_LABEL[line.status]}
                  {rentalIsConfirmed(line.status) ? " · confirmed" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="row-between">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Don't shift
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={checked.size === 0} onClick={onApply}>
            Shift checked
          </button>
        </div>
      </div>
    </div>
  );
}

export function RentalEquipmentSection({ billing, weeks, canEdit, saving, onSave }: Props) {
  const focusId = useRef<string | null>(null);
  const billingRef = useRef(billing);
  useEffect(() => {
    billingRef.current = billing;
  }, [billing]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editingWeek, setEditingWeek] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const equipment = billing.rentalEquipment ?? [];
  const cells = billing.rentalEquipmentCells ?? [];
  const reminders = rentalReminders(equipment, todayIso());
  const holidays = billing.holidays ?? [];
  const estimated = equipment.reduce((sum, line) => sum + (rentalQuoteForLine(line, holidays)?.total ?? 0), 0);

  function save(next: ProjectBillingData) {
    if (!canEdit) return;
    billingRef.current = next;
    onSave(next);
  }

  function patchLine(id: string, patch: Partial<RentalEquipment>) {
    const current = billingRef.current;
    save({
      ...current,
      rentalEquipment: current.rentalEquipment.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    });
  }

  function addEquipment() {
    const id = crypto.randomUUID();
    focusId.current = id;
    setOpenId(id);
    const current = billingRef.current;
    save({ ...current, rentalEquipment: [...current.rentalEquipment, blankRentalLine(id)] });
  }

  function duplicateEquipment(id: string) {
    const current = billingRef.current;
    const source = current.rentalEquipment.find((line) => line.id === id);
    if (!source) return;
    const copyId = crypto.randomUUID();
    const copy = { ...source, id: copyId, quantity: 1 };
    const index = current.rentalEquipment.findIndex((line) => line.id === id);
    const rentalEquipment = [...current.rentalEquipment];
    rentalEquipment.splice(index + 1, 0, copy);
    focusId.current = copyId;
    setOpenId(copyId);
    save({ ...current, rentalEquipment });
  }

  function removeEquipment(id: string) {
    if (openId === id) setOpenId(null);
    const current = billingRef.current;
    save({
      ...current,
      rentalEquipment: current.rentalEquipment.filter((line) => line.id !== id),
      rentalEquipmentCells: current.rentalEquipmentCells.filter((cell) => cell.equipmentId !== id),
    });
  }

  function setWeekOverride(id: string, week: string, quantity: number | null) {
    const current = billingRef.current;
    const rest = current.rentalEquipmentCells.filter(
      (cell) => !(cell.equipmentId === id && cell.weekStartIso === week && !cell.dayIso),
    );
    save({
      ...current,
      rentalEquipmentCells: quantity == null ? rest : [...rest, { equipmentId: id, weekStartIso: week, quantity }],
    });
  }

  function draftValue(key: string, stored: string | number | null): string {
    if (key in draft) return draft[key] ?? "";
    return stored == null ? "" : String(stored);
  }

  function remember(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function forget(key: string) {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return (
    <section className="billing-rental" aria-labelledby="rental-equipment-title">
      <div className="billing-rental-head">
        <div>
          <h3 id="rental-equipment-title">Rental equipment</h3>
          <p className="muted small">Select a row to edit its details.</p>
        </div>
        <div className="billing-rental-head-actions">
          {equipment.length > 0 ? (
            <span className="billing-rental-rent">
              Est. {formatMoney0(estimated)}
              {equipment.some((line) => !rentalQuoteForLine(line, holidays))
                ? ` (${equipment.filter((line) => !rentalQuoteForLine(line, holidays)).length} unpriced)`
                : ""}
            </span>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={addEquipment}>
              + Add equipment
            </button>
          ) : null}
        </div>
      </div>

      {reminders.length > 0 ? (
        <ul className="billing-rental-reminders">
          {reminders.map((reminder) => (
            <li key={`${reminder.kind}-${reminder.equipmentId}`} className={reminder.overdue ? "is-due" : ""}>
              {reminder.text}
            </li>
          ))}
        </ul>
      ) : null}

      {equipment.length === 0 ? (
        <p className="muted small">No rental equipment yet.</p>
      ) : (
        <div className="billing-rental-menu" tabIndex={0} aria-label="Rental equipment">
          <div className="billing-rental-cols billing-rental-cols-head" style={menuColumns(weeks.length)}>
            <span>Equipment</span>
            {weeks.map((week) => {
              const holiday = weekDayIsos(week).some((iso) => holidays.includes(iso));
              return (
                <span key={week} className={`num billing-rental-week-label${holiday ? " is-holiday" : ""}`} title={holiday ? "Includes a holiday" : undefined}>
                  {weekColumnLabel(week)}
                  {holiday ? <span className="billing-week-holiday-mark">Hol</span> : null}
                </span>
              );
            })}
            <span className="num">Unit-wks</span>
            <span className="num">Est.</span>
            <span>Status</span>
          </div>
          {equipment.map((line) => {
            const overrides = weekOverridesFor(cells, line.id);
            const unitWeeks = rentalUnitWeeks(line, weeks, overrides, holidays);
            const quote = rentalQuoteForLine(line, holidays);
            const orderBy = orderByIso(line.onRentIso);
            const callOffBy = callOffByIso(line.offRentIso);
            const datesInverted = Boolean(line.onRentIso && line.offRentIso && line.offRentIso < line.onRentIso);
            const open = openId === line.id;
            const missingRate = Boolean(line.onRentIso && line.offRentIso && !quote);
            const name = line.name.trim() || "Equipment";
            return (
              <article key={line.id} className={`billing-rental-card${open ? " is-open" : ""}`}>
                <div
                  className="billing-rental-summary"
                  style={menuColumns(weeks.length)}
                  onClick={() => setOpenId(open ? null : line.id)}
                >
                  <button
                    type="button"
                    className="billing-rental-toggle"
                    aria-expanded={open}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenId(open ? null : line.id);
                    }}
                  >
                    <span className="billing-rental-chevron" aria-hidden />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {rangeLabel(line.onRentIso, line.offRentIso)}
                        {line.skipClosedDays ? " · Weekdays" : ""}
                      </small>
                    </span>
                  </button>
                  {weeks.map((week) => {
                    const override = overrides.has(week) ? overrides.get(week)! : null;
                    const fill = rentalWeekFill(line, week, override, holidays);
                    const key = `${line.id}:${week}`;
                    const editing = editingWeek === key;
                    return (
                      <div key={week} className="billing-rental-week-cell" onClick={(event) => event.stopPropagation()}>
                        {editing ? (
                          <input
                            className="billing-rental-qty"
                            autoFocus
                            aria-label={`${name} week ${weekColumnLabel(week)}`}
                            defaultValue={fill && fill.quantity > 0 ? "1" : ""}
                            onBlur={(event) => {
                              const text = event.target.value.trim().toLowerCase();
                              const autoOn = (rentalWeekFill(line, week, null, holidays)?.quantity ?? 0) > 0;
                              const markedOff = text === "0" || text === "-" || text === "—";
                              const next = markedOff ? (autoOn ? 0 : null) : text === "" || autoOn ? null : 1;
                              setWeekOverride(line.id, week, next);
                              setEditingWeek(null);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`billing-rental-chip${fill?.overridden ? " is-override" : ""}${fill && fill.quantity > 0 ? "" : " is-empty"}`}
                            disabled={!canEdit || saving}
                            title={
                              fill?.overridden
                                ? "Edited for this week. Leave it blank to use the dates."
                                : "On rent this week. Type 0 to clear it."
                            }
                            onClick={() => setEditingWeek(key)}
                          >
                            {fill && fill.quantity > 0 ? (
                              <>
                                <strong>1</strong>
                                {fill.note ? <small>{fill.note}</small> : null}
                              </>
                            ) : (
                              <span>—</span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <span className="billing-rental-stat num">{unitWeeks > 0 ? unitWeeks : "—"}</span>
                  <span className="billing-rental-stat num" title={quote?.summary}>
                    {quote ? formatMoney0(quote.total) : "—"}
                  </span>
                  <span className="billing-rental-status">
                    <span>{RENTAL_STATUS_LABEL[line.status]}</span>
                    {missingRate ? <small>Missing rate</small> : null}
                  </span>
                </div>
                {open ? (
                  <div className="billing-rental-form">
                    <div className="billing-rental-form-row billing-rental-form-row--main">
                      <label>
                        Equipment
                        <input
                          id={`rental-name-${line.id}`}
                          ref={(node) => {
                            if (node && focusId.current === line.id) {
                              node.focus();
                              focusId.current = null;
                            }
                          }}
                          value={draftValue(`${line.id}:name`, line.name)}
                          maxLength={80}
                          placeholder="Boom, 45 ft"
                          aria-label="Equipment and size"
                          disabled={!canEdit || saving}
                          onChange={(event) => remember(`${line.id}:name`, event.target.value)}
                          onBlur={(event) => {
                            patchLine(line.id, { name: event.target.value });
                            forget(`${line.id}:name`);
                          }}
                        />
                      </label>
                      <label>
                        Qty
                        <input value="1" readOnly aria-label={`${name} quantity`} title="Each row is one piece. Duplicate the row for another." />
                      </label>
                      <label>
                        On rent
                        <DateInput
                          value={line.onRentIso}
                          disabled={!canEdit || saving}
                          onChange={(value) => patchLine(line.id, { onRentIso: toIsoDateValue(value) })}
                        />
                      </label>
                      <label>
                        Off rent
                        <DateInput
                          value={line.offRentIso}
                          disabled={!canEdit || saving}
                          onChange={(value) => patchLine(line.id, { offRentIso: toIsoDateValue(value) })}
                        />
                      </label>
                      <label>
                        Status
                        <select
                          aria-label={`${name} status`}
                          value={line.status}
                          disabled={!canEdit || saving}
                          onChange={(event) => patchLine(line.id, { status: event.target.value as RentalStatus })}
                        >
                          {RENTAL_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {RENTAL_STATUS_LABEL[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {datesInverted ? <p className="billing-rental-warn">Off-rent is before on-rent.</p> : null}
                    <div className="billing-rental-form-row billing-rental-form-row--pair">
                      <label>
                        Vendor
                        <input
                          value={draftValue(`${line.id}:vendor`, line.vendor)}
                          placeholder="Optional"
                          aria-label={`${name} vendor`}
                          disabled={!canEdit || saving}
                          onChange={(event) => remember(`${line.id}:vendor`, event.target.value)}
                          onBlur={(event) => {
                            patchLine(line.id, { vendor: event.target.value });
                            forget(`${line.id}:vendor`);
                          }}
                        />
                      </label>
                      <label>
                        PO #
                        <input
                          value={draftValue(`${line.id}:po`, line.poNumber)}
                          placeholder="Optional"
                          aria-label={`${name} PO number`}
                          disabled={!canEdit || saving}
                          onChange={(event) => remember(`${line.id}:po`, event.target.value)}
                          onBlur={(event) => {
                            patchLine(line.id, { poNumber: event.target.value });
                            forget(`${line.id}:po`);
                          }}
                        />
                      </label>
                    </div>
                    <div className="billing-rental-form-row billing-rental-form-row--rates">
                      {(
                        [
                          ["dayRate", "Day rate"],
                          ["weekRate", "Week rate"],
                          ["fourWeekRate", "4-week rate"],
                          ["deliveryPickup", "Delivery"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          {label}
                          <input
                            inputMode="decimal"
                            aria-label={`${name} ${label}`}
                            value={draftValue(`${line.id}:${field}`, line[field])}
                            disabled={!canEdit || saving}
                            onChange={(event) => remember(`${line.id}:${field}`, event.target.value)}
                            onBlur={(event) => {
                              patchLine(line.id, { [field]: parseRate(event.target.value) });
                              forget(`${line.id}:${field}`);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="billing-rental-form-foot">
                      <span className="billing-rental-deadlines">
                        <FlagSwitch
                          label="Skip weekends and holidays"
                          tone="accent"
                          checked={line.skipClosedDays}
                          disabled={!canEdit || saving}
                          onChange={(on) => patchLine(line.id, { skipClosedDays: on })}
                        />
                        {orderBy ? <span>Order by {shortDate(orderBy)}</span> : null}
                        {callOffBy ? <span>Call off by {shortDate(callOffBy)}</span> : null}
                      </span>
                      {canEdit ? (
                        <span className="billing-rental-line-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={saving}
                            onClick={() => duplicateEquipment(line.id)}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm billing-rental-remove"
                            disabled={saving}
                            onClick={() => removeEquipment(line.id)}
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
