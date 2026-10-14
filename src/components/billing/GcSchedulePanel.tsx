import { useEffect, useState } from "react";
import { DateInput } from "../DateInput";
import { toIsoDateValue } from "../../lib/dateInputUtils";
import type { GcScheduleActivity, GcTrade } from "../../lib/gcScheduleImport";
import {
  addGcHours,
  defaultPhaseId,
  phasesForTrade,
  placeGcActivity,
  splitGcHours,
  upcomingEventTitle,
} from "../../lib/gcSchedulePlacement";
import { addUpcomingFromGcSchedule } from "../../lib/gcScheduleUpcoming";
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

function ProjectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 9h16M9 9v10" fill="none" stroke="currentColor" strokeWidth="1.6" />
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
  onBillingChange,
  onPersistQuiet,
}: Props) {
  const storedKey = JSON.stringify(billing.gcSchedule?.items ?? []);
  const [items, setItems] = useState<GcScheduleSavedItem[]>(() => billing.gcSchedule?.items ?? []);
  const [hourText, setHourText] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setItems(billing.gcSchedule?.items ?? []);
    setHourText({});
    // storedKey is the saved list; local edits stay until the projection is saved again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const saved = billing.gcSchedule;
  const busy = saving || busyId !== null;
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  function toggleSelected(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(items.map((item) => item.id)) : new Set());
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function patch(id: string, next: Partial<GcScheduleSavedItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  async function persist(next: ProjectBillingData, note: string) {
    onBillingChange(next);
    const ok = await onPersistQuiet(next);
    setMessage(ok ? note : "Could not save the GC schedule.");
    return ok;
  }

  async function saveList() {
    const cleaned = items
      .map((item) => ({ ...item, name: item.name.replace(/\s+/g, " ").trim() }))
      .filter((item) => item.name);
    await persist(scheduleBilling(billing, cleaned), "GC schedule saved.");
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
      },
    ]);
    setExpandedId(id);
    setMessage(null);
  }

  function resolveTargets(seed: GcScheduleSavedItem): GcScheduleSavedItem[] {
    if (!selected.has(seed.id)) return [seed];
    const picked = items.filter((row) => selected.has(row.id));
    return picked.length ? picked : [seed];
  }

  async function removeRow(id: string) {
    const nextItems = items.filter((item) => item.id !== id);
    setItems(nextItems);
    await persist(scheduleBilling(billing, nextItems.filter((item) => item.name.trim())), "Activity removed.");
  }

  async function addToProjection(seed: GcScheduleSavedItem) {
    const targets = resolveTargets(seed);
    const problems: string[] = [];
    const placed = new Map<string, string>();
    let cells = billing.manpowerCells;
    for (const item of targets) {
      const name = item.name.trim() || "An activity";
      if (!item.name.trim()) {
        problems.push("Name each activity before adding it to the projection.");
        continue;
      }
      if (!(item.hours > 0)) {
        problems.push(`${name} needs hours.`);
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
      if (placement.destination !== "projection" || !placement.phaseId || placement.projectionWeeks.length === 0) {
        problems.push(placement.note || `${name} does not fall on the projection weeks.`);
        continue;
      }
      cells = addGcHours(cells, splitGcHours(placement.phaseId, placement.projectionWeeks, item.hours));
      placed.set(item.id, placement.phaseId);
    }
    if (!placed.size) {
      setMessage(problems[0] ?? "Nothing could be added to the projection.");
      return;
    }
    setBusyId(seed.id);
    setMessage(null);
    try {
      const nextItems = items.map((row) =>
        placed.has(row.id)
          ? {
              ...row,
              name: row.name.trim(),
              status: "projection" as const,
              phaseId: placed.get(row.id) ?? row.phaseId,
              upcomingDateIso: "",
              upcomingTitle: "",
            }
          : row,
      );
      const note =
        placed.size === 1
          ? "Hours added on the projection."
          : `Hours added for ${placed.size} activities on the projection.`;
      await persist(
        {
          ...scheduleBilling(billing, nextItems.filter((row) => row.name.trim())),
          manpowerCells: cells,
        },
        problems.length ? `${note} ${problems[0]}` : note,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function addToUpcoming(seed: GcScheduleSavedItem) {
    if (!projectId) {
      setMessage("This job has no id, so Upcoming was not updated.");
      return;
    }
    const targets = resolveTargets(seed);
    const ready: { item: GcScheduleSavedItem; eventDate: string; title: string }[] = [];
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
      ready.push({ item, eventDate, title: upcomingEventTitle(jobNumber, name) });
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
        ready.map((row) => ({ event_date: row.eventDate, title: row.title })),
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
            aria-label="Select all activities"
            checked={allSelected}
            disabled={busy || items.length === 0}
            onChange={(event) => toggleAll(event.target.checked)}
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
          const hourValue = hourText[item.id] ?? (item.hours ? String(item.hours) : "");
          return (
            <article key={item.id} className={`gc-schedule-row${open ? " is-open" : ""}${selected.has(item.id) ? " is-selected" : ""}`}>
              <div className="gc-schedule-line">
                {canEdit ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name || "activity"}`}
                    checked={selected.has(item.id)}
                    disabled={busy}
                    onChange={(event) => toggleSelected(item.id, event.target.checked)}
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
                <span className="gc-schedule-dates">{dateRange(item.startIso, item.finishIso)}</span>
                {canEdit ? (
                  <input
                    className="gc-schedule-hour-box"
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="—"
                    aria-label={`Hours for ${item.name || "activity"}`}
                    value={hourValue}
                    disabled={busy}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setHourText((prev) => ({ ...prev, [item.id]: raw }));
                      const n = Number(raw);
                      if (raw.trim() === "") patch(item.id, { hours: 0 });
                      else if (Number.isFinite(n) && n >= 0) patch(item.id, { hours: Math.round(n * 10) / 10 });
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
                        className={`gc-schedule-icon${item.status === "projection" ? " is-on" : ""}`}
                        aria-label={`Add ${item.name || "activity"} to the projection`}
                        title={item.status === "projection" ? "On the projection" : "Add to projection"}
                        disabled={busy}
                        onClick={() => void addToProjection(item)}
                      >
                        <ProjectionIcon />
                      </button>
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
                  <p className="gc-schedule-need">Needed for projection</p>
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
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void saveList()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
