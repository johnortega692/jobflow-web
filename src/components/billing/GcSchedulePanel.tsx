import { useEffect, useState } from "react";
import { DateInput } from "../DateInput";
import { FlagSwitch } from "../jobinfo/StageStepper";
import { toIsoDateValue } from "../../lib/dateInputUtils";
import type { GcScheduleActivity, GcTrade } from "../../lib/gcScheduleImport";
import {
  defaultPhaseId,
  phasesForTrade,
  placeGcActivity,
  upcomingEventTitle,
  upcomingSpanEnd,
} from "../../lib/gcSchedulePlacement";
import { addUpcomingFromGcSchedule, updateUpcomingFromGcSchedule } from "../../lib/gcScheduleUpcoming";
import type { SpreadActivityHours } from "../../lib/spreadBudgetHours";
import { SpreadBudgetHours } from "./SpreadBudgetHours";
import {
  phaseDisplayLabel,
  type GcScheduleSavedItem,
  type ManpowerPhase,
  type ProjectBillingData,
} from "../../types/projectBilling";

type Props = {
  billing: ProjectBillingData;
  phases: ManpowerPhase[];
  weekStarts: string[];
  projectStartIso: string;
  projectEndIso: string;
  projectId: string;
  jobNumber: string;
  saving: boolean;
  canEdit: boolean;
  gridStart: string;
  weekCount: number;
  spreadCanUndo: boolean;
  onSpreadPreview: (rows: { id: string; hours: number[] }[] | null) => void;
  onSpreadApply: (rows: { id: string; hours: number[]; dayHours: number[][] }[], savedItems: GcScheduleSavedItem[]) => void;
  onSpreadUndo: () => void;
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
};

function activityFromItem(item: GcScheduleSavedItem): GcScheduleActivity {
  return {
    key: item.id,
    activityId: item.activityId,
    name: item.name.trim(),
    trade: item.trade,
    alsoPaint: false,
    startIso: item.startIso || null,
    finishIso: item.finishIso || null,
    suggestedHours: item.hours,
    durationLabel: "",
  };
}

function scheduleBilling(billing: ProjectBillingData, items: GcScheduleSavedItem[]): ProjectBillingData {
  const current = billing.gcSchedule;
  return {
    ...billing,
    gcSchedule: {
      fileName: current?.fileName ?? "",
      importedAt: current?.importedAt || new Date().toISOString(),
      items,
    },
  };
}

function statusLabel(item: GcScheduleSavedItem): string {
  if (item.status === "projection") return "On the projection";
  if (item.status === "upcoming") return "On Upcoming";
  return "Not sent";
}

function formatCostCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
  return code.trim();
}

function shortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function dateRange(startIso: string, finishIso: string): string {
  const start = shortDate(startIso);
  const finish = shortDate(finishIso);
  if (start && finish && start !== finish) return `${start} – ${finish}`;
  return start || finish || "—";
}

function tradeShort(trade: GcTrade): string {
  return trade === "wallcovering" ? "WC" : "Paint";
}

function FileIcon() {
  return (
    <svg className="gc-schedule-file-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M14 3.5V9h5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function UpcomingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h8l-2.2-2.2M15 7l-2.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5" y="10" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h8M9 7V5.5h6V7M9 10v7M12 10v7M15 10v7M7.5 7l.7 12h7.6l.7-12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GcSchedulePanel({
  billing,
  phases,
  weekStarts,
  projectStartIso,
  projectEndIso,
  projectId,
  jobNumber,
  saving,
  canEdit,
  gridStart,
  weekCount,
  spreadCanUndo,
  onSpreadPreview,
  onSpreadApply,
  onSpreadUndo,
  onBillingChange,
  onPersistQuiet,
}: Props) {
  const storedKey = JSON.stringify(billing.gcSchedule?.items ?? []);
  const [items, setItems] = useState<GcScheduleSavedItem[]>(() => billing.gcSchedule?.items ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [spreadOff, setSpreadOff] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setItems(billing.gcSchedule?.items ?? []);
    // storedKey is the saved list; local edits stay until the projection is saved again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const saved = billing.gcSchedule;
  const busy = saving || busyId !== null;
  const allSpread = items.length > 0 && items.every((item) => !spreadOff.has(item.id));

  function setSpread(id: string, on: boolean) {
    setSpreadOff((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllSpread(on: boolean) {
    setSpreadOff(on ? new Set() : new Set(items.map((item) => item.id)));
  }

  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const spreadActivities: SpreadActivityHours[] = items.flatMap((item) => {
    const phase = item.phaseId ? phaseById.get(item.phaseId) : undefined;
    if (!item.name.trim() || !phase || phase.hidden || spreadOff.has(item.id)) return [];
    const budgetHours = phase.budgetHours;
    if (!(item.hours > 0) && !(budgetHours > 0)) return [];
    if (!(item.startIso || item.finishIso)) return [];
    return [{
      id: item.id,
      phaseId: item.phaseId,
      hours: item.hours,
      budgetHours,
      startIso: item.startIso,
      endIso: item.finishIso || item.startIso,
      includeWeekends: item.includeWeekends,
    }];
  });

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function patch(id: string, next: Partial<GcScheduleSavedItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  function setWeekends(item: GcScheduleSavedItem, includeWeekends: boolean) {
    const nextItems = items.map((row) => (row.id === item.id ? { ...row, includeWeekends } : row));
    setItems(nextItems);
    if (!item.name.trim()) return;
    void persist(
      scheduleBilling(billing, nextItems.filter((row) => row.name.trim())),
      includeWeekends ? "Weekends included for this activity." : "This activity stays on weekdays.",
    );
  }

  async function persist(next: ProjectBillingData, note: string) {
    onBillingChange(next);
    const ok = await onPersistQuiet(next);
    setMessage(ok ? note : "Could not save the GC schedule.");
    return ok;
  }

  async function prepareSchedule(): Promise<{ items: GcScheduleSavedItem[]; upcomingNote: string } | null> {
    if (busy) return null;
    const cleaned = items
      .map((item) => ({ ...item, name: item.name.replace(/\s+/g, " ").trim() }))
      .filter((item) => item.name);
    const previous = new Map((billing.gcSchedule?.items ?? []).map((item) => [item.id, item]));
    const edits = cleaned.flatMap((item) => {
      if (item.status !== "upcoming") return [];
      const prev = previous.get(item.id);
      if (!prev || prev.status !== "upcoming") return [];
      const previousDate = prev.upcomingDateIso || prev.startIso || prev.finishIso;
      const previousTitle = prev.upcomingTitle || upcomingEventTitle(jobNumber, prev.name);
      const eventDate = item.startIso || item.finishIso;
      const title = upcomingEventTitle(jobNumber, item.name);
      const previousEnd = upcomingSpanEnd(previousDate, prev.finishIso);
      const endDate = upcomingSpanEnd(eventDate, item.finishIso);
      if (!previousDate || !previousTitle || !eventDate || !title) return [];
      if (previousDate === eventDate && previousTitle === title && previousEnd === endDate) return [];
      return [{
        id: item.id,
        previous_date: previousDate,
        previous_title: previousTitle,
        event_date: eventDate,
        end_date: endDate,
        title,
      }];
    });
    let nextItems = cleaned;
    let upcomingNote = "";
    if (edits.length && projectId) {
      setBusyId("save");
      try {
        const result = await updateUpcomingFromGcSchedule(projectId, edits);
        if (result.error) {
          upcomingNote = `Upcoming was not updated: ${result.error}`;
        } else {
          const updated = new Set(result.updatedIds);
          nextItems = cleaned.map((item) => {
            const edit = edits.find((row) => row.id === item.id);
            if (!edit || !updated.has(item.id)) return item;
            return { ...item, upcomingDateIso: edit.event_date, upcomingTitle: edit.title };
          });
          upcomingNote = result.errors[0]
            ? `${result.errors[0].title || "An activity"}: ${result.errors[0].message}`
            : "Upcoming was updated.";
        }
      } finally {
        setBusyId(null);
      }
    }
    return { items: nextItems, upcomingNote };
  }

  async function saveList() {
    const prepared = await prepareSchedule();
    if (!prepared) return;
    const note = prepared.upcomingNote ? `Schedule saved. ${prepared.upcomingNote}` : "Schedule saved.";
    await persist(scheduleBilling(billing, prepared.items), note);
  }

  async function placeOnWeeks(rows: { id: string; hours: number[]; dayHours: number[][] }[]) {
    const prepared = await prepareSchedule();
    if (!prepared) return;
    await onSpreadApply(rows, prepared.items);
    setMessage(prepared.upcomingNote ? `Hours placed on the weeks. ${prepared.upcomingNote}` : "Hours placed on the weeks.");
  }

  function addRow() {
    const trade: GcTrade = "paint";
    const id = `manual:${crypto.randomUUID()}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        activityId: "",
        name: "",
        trade,
        startIso: "",
        finishIso: "",
        hours: 0,
        phaseId: defaultPhaseId(phases, trade, ""),
        status: "open",
        upcomingDateIso: "",
        upcomingTitle: "",
        includeWeekends: false,
      },
    ]);
    setExpandedId(id);
    setMessage(null);
  }

  async function removeRow(id: string) {
    const nextItems = items.filter((item) => item.id !== id);
    setItems(nextItems);
    await persist(scheduleBilling(billing, nextItems.filter((item) => item.name.trim())), "Activity removed.");
  }

  async function addToUpcoming(seed: GcScheduleSavedItem) {
    if (!projectId) {
      setMessage("This job has no id, so Upcoming was not updated.");
      return;
    }
    const targets = [seed];
    const ready: { item: GcScheduleSavedItem; eventDate: string; endDate: string; title: string }[] = [];
    const problems: string[] = [];
    for (const item of targets) {
      const name = item.name.trim();
      if (!name) {
        problems.push("Name each activity before adding it to Upcoming.");
        continue;
      }
      const placement = placeGcActivity({
        activity: activityFromItem(item),
        trade: item.trade,
        phaseId: item.phaseId,
        phases,
        weekStarts,
        projectStartIso,
        projectEndIso,
      });
      const eventDate = item.startIso || item.finishIso || placement.upcomingDateIso || "";
      if (!eventDate) {
        problems.push(`${name} needs a date before it can go on Upcoming.`);
        continue;
      }
      ready.push({
        item,
        eventDate,
        endDate: upcomingSpanEnd(eventDate, item.finishIso),
        title: upcomingEventTitle(jobNumber, name),
      });
    }
    if (!ready.length) {
      setMessage(problems[0] ?? "Nothing could be added to Upcoming.");
      return;
    }
    setBusyId(seed.id);
    setMessage(null);
    try {
      const result = await addUpcomingFromGcSchedule(
        projectId,
        ready.map((row) => ({ event_date: row.eventDate, end_date: row.endDate, title: row.title })),
      );
      if (result.error) {
        setMessage(result.error);
        return;
      }
      const failed = new Set(result.errors.map((row) => row.title));
      const sent = new Map(ready.filter((row) => !failed.has(row.title)).map((row) => [row.item.id, row]));
      if (!sent.size) {
        setMessage(result.errors[0]?.message ?? problems[0] ?? "Upcoming was not updated.");
        return;
      }
      const nextItems = items.map((row) => {
        const match = sent.get(row.id);
        if (!match) return row;
        return {
          ...row,
          name: match.item.name.trim(),
          status: "upcoming" as const,
          upcomingDateIso: match.eventDate,
          upcomingTitle: match.title,
        };
      });
      const note =
        result.errors[0]?.message ??
        problems[0] ??
        (sent.size === 1 ? "Added to Upcoming." : `Added ${sent.size} activities to Upcoming.`);
      await persist(scheduleBilling(billing, nextItems.filter((row) => row.name.trim())), note);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="gc-schedule-board">
      <div className="gc-schedule-file">
        <FileIcon />
        <span>{saved?.fileName || "GC schedule"}</span>
      </div>
      {message ? <p className="gc-schedule-done">{message}</p> : null}
      <div className="gc-schedule-line gc-schedule-line--head">
        {canEdit ? (
          <input
            type="checkbox"
            aria-label="Include every activity's hours in the spread"
            checked={allSpread}
            disabled={busy || items.length === 0}
            onChange={(event) => setAllSpread(event.target.checked)}
          />
        ) : (
          <span />
        )}
        <span>ID</span>
        <span>Activity</span>
        <span>Trade · code</span>
        <span>GC dates</span>
        <span>Hours</span>
        <span>Sent to</span>
      </div>
      {items.length === 0 ? (
        <p className="muted small gc-schedule-empty">No GC schedule is stored on this projection yet.</p>
      ) : (
        items.map((item) => {
          const tradePhases = phasesForTrade(phases, item.trade);
          const phase = tradePhases.find((row) => row.id === item.phaseId) ?? tradePhases[0];
          const code = phase ? formatCostCode(phase.costCode) : "";
          const tradeLabel = code ? `${tradeShort(item.trade)} · ${code}` : tradeShort(item.trade);
          const open = expandedId === item.id;
          return (
            <article key={item.id} className={`gc-schedule-row${open ? " is-open" : ""}`}>
              <div className="gc-schedule-line">
                {canEdit ? (
                  <input
                    type="checkbox"
                    aria-label={`Include ${item.name || "activity"} hours in the spread`}
                    checked={!spreadOff.has(item.id)}
                    disabled={busy}
                    onChange={(event) => setSpread(item.id, event.target.checked)}
                  />
                ) : (
                  <span />
                )}
                <span className="gc-schedule-id-col">{item.activityId || "—"}</span>
                <button
                  type="button"
                  className="gc-schedule-activity"
                  aria-expanded={open}
                  onClick={() => toggleExpanded(item.id)}
                >
                  {item.name || "Untitled activity"}
                </button>
                <span className="gc-schedule-trade-code">{tradeLabel}</span>
                <span className="gc-schedule-dates">
                  {dateRange(item.startIso, item.finishIso)}
                  {item.includeWeekends ? <span className="gc-schedule-weekend">Weekends</span> : null}
                </span>
                {canEdit ? (
                  <input
                    className="gc-schedule-hour-box"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="0"
                    aria-label={`Hours to spread for ${item.name || "activity"}`}
                    value={item.hours || ""}
                    disabled={busy}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const n = Number(raw);
                      if (raw.trim() === "") patch(item.id, { hours: 0 });
                      else if (Number.isFinite(n) && n >= 0) patch(item.id, { hours: Math.round(n) });
                    }}
                  />
                ) : (
                  <span className="gc-schedule-hour-box is-readonly">{item.hours || "—"}</span>
                )}
                <span className="gc-schedule-sent">
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className={`gc-schedule-icon${item.status === "upcoming" ? " is-on" : ""}`}
                        aria-label={`Add ${item.name || "activity"} to Upcoming`}
                        title={item.status === "upcoming" ? "On Upcoming" : "Add to Upcoming"}
                        disabled={busy}
                        onClick={() => void addToUpcoming(item)}
                      >
                        <UpcomingIcon />
                      </button>
                    </>
                  ) : (
                    <span className="muted small">{statusLabel(item)}</span>
                  )}
                  <button
                    type="button"
                    className={`gc-schedule-icon gc-schedule-chevron${open ? " is-open" : ""}`}
                    aria-label={open ? "Hide details" : "Edit details"}
                    title={open ? "Hide details" : "Edit details"}
                    onClick={() => toggleExpanded(item.id)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              </div>
              {open ? (
                <div className="gc-schedule-detail">
                  <label>
                    Activity name
                    {canEdit ? (
                      <input
                        value={item.name}
                        disabled={busy}
                        onChange={(event) => patch(item.id, { name: event.target.value })}
                      />
                    ) : (
                      <span>{item.name || "—"}</span>
                    )}
                  </label>
                  <label>
                    Start
                    {canEdit ? (
                      <DateInput
                        value={item.startIso}
                        disabled={busy}
                        onChange={(value) => patch(item.id, { startIso: toIsoDateValue(value) })}
                      />
                    ) : (
                      <span>{item.startIso ? shortDate(item.startIso) : "—"}</span>
                    )}
                  </label>
                  <label>
                    Finish
                    {canEdit ? (
                      <DateInput
                        value={item.finishIso}
                        disabled={busy}
                        onChange={(value) => patch(item.id, { finishIso: toIsoDateValue(value) })}
                      />
                    ) : (
                      <span>{item.finishIso ? shortDate(item.finishIso) : "—"}</span>
                    )}
                  </label>
                  <div className="gc-schedule-days">
                    <span>Days</span>
                    {canEdit ? (
                      <FlagSwitch
                        label="Include weekends"
                        tone="accent"
                        checked={item.includeWeekends}
                        disabled={busy}
                        onChange={(on) => setWeekends(item, on)}
                      />
                    ) : (
                      <span>{item.includeWeekends ? "Includes weekends" : "Weekdays"}</span>
                    )}
                  </div>
                  <label>
                    Trade
                    {canEdit ? (
                      <select
                        aria-label={`Trade for ${item.name || "activity"}`}
                        value={item.trade}
                        disabled={busy}
                        onChange={(event) => {
                          const trade = event.target.value as GcTrade;
                          patch(item.id, { trade, phaseId: defaultPhaseId(phases, trade, item.name) });
                        }}
                      >
                        <option value="paint">Paint</option>
                        <option value="wallcovering">Wallcovering</option>
                      </select>
                    ) : (
                      <span>{item.trade === "wallcovering" ? "Wallcovering" : "Paint"}</span>
                    )}
                  </label>
                  <label>
                    Cost code
                    {canEdit && tradePhases.length > 0 ? (
                      <select
                        aria-label={`Cost code for ${item.name || "activity"}`}
                        value={phase?.id ?? ""}
                        disabled={busy}
                        onChange={(event) => patch(item.id, { phaseId: event.target.value })}
                      >
                        {tradePhases.map((row) => (
                          <option key={row.id} value={row.id}>
                            {formatCostCode(row.costCode) || phaseDisplayLabel(row)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{code || "—"}</span>
                    )}
                  </label>
                  {canEdit ? (
                    <button
                      type="button"
                      className="gc-schedule-remove"
                      disabled={busy}
                      onClick={() => void removeRow(item.id)}
                    >
                      <TrashIcon />
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })
      )}
      {canEdit ? (
        <div className="gc-schedule-footer">
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={addRow}>
            + Add activity
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void saveList()}>
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      ) : null}
      {canEdit && weekCount > 0 ? (
        <SpreadBudgetHours
          activities={spreadActivities}
          gridStart={gridStart}
          weekCount={weekCount}
          holidays={billing.holidays}
          saving={saving}
          canUndo={spreadCanUndo}
          onPreview={onSpreadPreview}
          onApply={(rows) => void placeOnWeeks(rows)}
          onUndo={onSpreadUndo}
        />
      ) : null}
    </div>
  );
}
