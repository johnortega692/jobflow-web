import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GcScheduleActivity, GcScheduleParseResult, GcTrade } from "../../lib/gcScheduleImport";
import {
  addGcHours,
  defaultPhaseId,
  phasesForTrade,
  placeGcActivity,
  splitGcHours,
  upcomingEventTitle,
} from "../../lib/gcSchedulePlacement";
import { addUpcomingFromGcSchedule } from "../../lib/gcScheduleUpcoming";
import { formatJobDateLabel } from "../../lib/manpowerCalendar";
import {
  phaseDisplayLabel,
  type GcScheduleSaved,
  type GcScheduleSavedItem,
  type GcScheduleStatus,
  type ManpowerPhase,
  type ProjectBillingData,
} from "../../types/projectBilling";

type Draft = {
  use: boolean;
  hours: string;
  trade: GcTrade;
  phaseId: string;
};

type Props = {
  billing: ProjectBillingData;
  phases: ManpowerPhase[];
  weekStarts: string[];
  projectStartIso: string;
  projectEndIso: string;
  projectId: string;
  jobNumber: string;
  saving: boolean;
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
  onStored?: () => void;
};

function parseHours(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10) / 10;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "No date";
  return formatJobDateLabel(iso) ?? iso;
}

export function GcScheduleImport({
  billing,
  phases,
  weekStarts,
  projectStartIso,
  projectEndIso,
  projectId,
  jobNumber,
  saving,
  onBillingChange,
  onPersistQuiet,
  onStored,
}: Props) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingLabel, setReadingLabel] = useState("Reading schedule…");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<GcScheduleParseResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [placeActivities, setPlaceActivities] = useState(true);
  const [doneLines, setDoneLines] = useState<string[] | null>(null);

  const busy = reading || applying || saving;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, open]);

  const rows = useMemo(() => {
    if (!parsed) return [];
    return parsed.activities.map((activity) => {
      const draft = drafts[activity.key];
      const placement = placeGcActivity({
        activity,
        trade: draft?.trade ?? activity.trade,
        phaseId: draft?.phaseId ?? "",
        phases,
        weekStarts,
        projectStartIso,
        projectEndIso,
      });
      return { activity, draft, placement };
    });
  }, [drafts, parsed, phases, projectEndIso, projectStartIso, weekStarts]);

  const usable = rows.filter((row) => row.draft && !row.placement.blocked);
  const chosen = usable.filter((row) => row.draft!.use);
  const projectionCount = chosen.filter(
    (row) => row.placement.destination === "projection" && parseHours(row.draft!.hours) > 0,
  ).length;
  const upcomingCount = chosen.filter((row) => row.placement.destination === "upcoming").length;
  const needsHours = chosen.filter(
    (row) => row.placement.destination === "projection" && parseHours(row.draft!.hours) <= 0,
  ).length;

  function resetFile() {
    setParsed(null);
    setDrafts({});
    setPlaceActivities(true);
    setDoneLines(null);
    setError(null);
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  function openFresh() {
    resetFile();
    setOpen(true);
  }

  function draftsFor(result: GcScheduleParseResult): Record<string, Draft> {
    const next: Record<string, Draft> = {};
    for (const activity of result.activities) {
      const phaseId = defaultPhaseId(phases, activity.trade, activity.name);
      const placement = placeGcActivity({
        activity,
        trade: activity.trade,
        phaseId,
        phases,
        weekStarts,
        projectStartIso,
        projectEndIso,
      });
      next[activity.key] = {
        use: !placement.blocked,
        hours: activity.suggestedHours > 0 ? String(activity.suggestedHours) : "",
        trade: activity.trade,
        phaseId,
      };
    }
    return next;
  }

  async function readFile(file: File) {
    setReading(true);
    setReadingLabel("Reading schedule…");
    setError(null);
    setDoneLines(null);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    try {
      const { parseGcScheduleFile } = await import("../../lib/gcScheduleImport");
      let result = await parseGcScheduleFile(file);
      if (isPdf && result.activities.length === 0) {
        setReadingLabel("No activities in the text. Reading the pages with AI…");
        const { extractGcScheduleWithAi } = await import("../../lib/gcScheduleAi");
        result = await extractGcScheduleWithAi(file);
      }
      setParsed(result);
      setDrafts(draftsFor(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read that schedule.";
      if (isPdf && /no selectable text/i.test(message)) {
        try {
          setReadingLabel("This PDF has no selectable text. Reading it with AI…");
          const { extractGcScheduleWithAi } = await import("../../lib/gcScheduleAi");
          const result = await extractGcScheduleWithAi(file);
          setParsed(result);
          setDrafts(draftsFor(result));
          setError(null);
        } catch (aiErr) {
          setParsed(null);
          setDrafts({});
          setError(aiErr instanceof Error ? aiErr.message : message);
        }
      } else {
        setParsed(null);
        setDrafts({});
        setError(message);
      }
    } finally {
      setReading(false);
    }
  }

  function setDraft(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  function setTrade(activity: GcScheduleActivity, trade: GcTrade) {
    setDraft(activity.key, {
      trade,
      phaseId: defaultPhaseId(phases, trade, activity.name),
    });
  }

  function setAll(use: boolean) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (row.placement.blocked || !next[row.activity.key]) continue;
        next[row.activity.key] = { ...next[row.activity.key]!, use };
      }
      return next;
    });
  }

  function savedSchedule(
    projectionSaved: boolean,
    upcomingFailed: Set<string>,
    upcomingSent: boolean,
    leaveUnset = false,
  ): GcScheduleSaved {
    const manual = (billing.gcSchedule?.items ?? []).filter((item) => item.id.startsWith("manual:"));
    const imported: GcScheduleSavedItem[] = rows.flatMap((row, index) => {
      const draft = row.draft;
      if (!draft?.use || row.placement.blocked) return [];
      const hours = leaveUnset ? 0 : parseHours(draft.hours);
      const used = !leaveUnset;
      const title = upcomingEventTitle(jobNumber, row.activity.name);
      let status: GcScheduleStatus = "open";
      if (used && row.placement.destination === "projection" && hours > 0 && projectionSaved) {
        status = "projection";
      } else if (
        used &&
        row.placement.destination === "upcoming" &&
        upcomingSent &&
        !upcomingFailed.has(title)
      ) {
        status = "upcoming";
      }
      return {
        id: `gc:${index}:${row.activity.activityId || row.activity.key}`.slice(0, 180),
        activityId: row.activity.activityId,
        name: row.activity.name,
        trade: draft?.trade ?? row.activity.trade,
        startIso: row.activity.startIso ?? "",
        finishIso: row.activity.finishIso ?? "",
        hours,
        phaseId: leaveUnset ? "" : row.placement.phaseId,
        status,
        upcomingDateIso: status === "upcoming" ? row.placement.upcomingDateIso ?? "" : "",
        upcomingTitle: status === "upcoming" ? title : "",
      };
    });
    return {
      fileName: parsed?.sourceLabel ?? "",
      importedAt: new Date().toISOString(),
      items: [...imported, ...manual],
    };
  }

  async function apply() {
    if (!parsed || applying) return;
    if (!placeActivities) {
      if (chosen.length === 0) return;
      setApplying(true);
      setError(null);
      try {
        const next = {
          ...billing,
          gcSchedule: savedSchedule(false, new Set(), false, true),
        };
        onBillingChange(next);
        const saved = await onPersistQuiet(next);
        if (!saved) {
          setError("Could not save the GC schedule.");
          return;
        }
        onStored?.();
        const count = chosen.length;
        setDoneLines([
          count === 1
            ? "Saved 1 activity on the GC schedule tab. Hours and where it goes were left unset."
            : `Saved ${count} activities on the GC schedule tab. Hours and where it goes were left unset.`,
        ]);
      } finally {
        setApplying(false);
      }
      return;
    }
    const projectionAdds = chosen.flatMap((row) => {
      if (row.placement.destination !== "projection" || !row.placement.phaseId) return [];
      return splitGcHours(row.placement.phaseId, row.placement.projectionWeeks, parseHours(row.draft!.hours));
    });
    const upcomingItems = chosen.flatMap((row) => {
      if (row.placement.destination !== "upcoming" || !row.placement.upcomingDateIso) return [];
      return [
        {
          event_date: row.placement.upcomingDateIso,
          title: upcomingEventTitle(jobNumber, row.activity.name),
        },
      ];
    });
    if (!projectionAdds.length && !upcomingItems.length) return;

    setApplying(true);
    setError(null);
    const lines: string[] = [];
    try {
      let cells = billing.manpowerCells;
      let projectionSaved = false;
      if (projectionAdds.length) {
        cells = addGcHours(cells, projectionAdds);
        projectionSaved = true;
        const activityCount = chosen.filter(
          (row) => row.placement.destination === "projection" && parseHours(row.draft!.hours) > 0,
        ).length;
        lines.push(
          activityCount === 1
            ? "Added hours for 1 activity on the projection."
            : `Added hours for ${activityCount} activities on the projection.`,
        );
      }

      let upcomingFailed = new Set<string>();
      let upcomingSent = false;
      const draftNext = {
        ...billing,
        manpowerCells: cells,
        gcSchedule: savedSchedule(projectionSaved, upcomingFailed, false),
      };
      onBillingChange(draftNext);
      const draftSaved = await onPersistQuiet(draftNext);
      if (!draftSaved) {
        setError("Could not save the projection.");
        return;
      }
      onStored?.();

      if (upcomingItems.length && !projectId) {
        setError("The schedule is saved on this projection. This job has no id, so Upcoming was not updated.");
        setDoneLines(lines);
        return;
      }
      if (upcomingItems.length) {
        const result = await addUpcomingFromGcSchedule(projectId, upcomingItems);
        if (result.error) {
          setError(
            lines.length
              ? `The schedule is saved. Upcoming could not be updated: ${result.error}`
              : result.error,
          );
          setDoneLines(lines);
          return;
        }
        upcomingSent = true;
        upcomingFailed = new Set(result.errors.map((item) => item.title));
        if (result.added > 0) {
          lines.push(
            result.added === 1 ? "Added 1 activity to Upcoming." : `Added ${result.added} activities to Upcoming.`,
          );
        }
        for (const item of result.errors) {
          lines.push(`${item.title || "Activity"}: ${item.message}`);
        }
        const next = {
          ...draftNext,
          gcSchedule: savedSchedule(projectionSaved, upcomingFailed, upcomingSent),
        };
        onBillingChange(next);
        const marked = await onPersistQuiet(next);
        if (!marked) {
          setError("Upcoming was updated, but the stored schedule status did not save.");
          setDoneLines(lines);
          return;
        }
      }

      lines.push("The GC schedule is stored on this projection.");
      setDoneLines(lines);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={openFresh} disabled={saving}>
        Import GC schedule
      </button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={close}>
          <div
            className="modal card stack gc-schedule-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row-between wrap gap">
              <h2 id={titleId} className="billing-card-title">
                Import GC schedule
              </h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={close} disabled={busy}>
                Close
              </button>
            </div>

            <p className="muted small">
              Paint and wallcovering activities from the GC schedule. Check an activity to add it to this job.
              Unchecked activities are left out. A date that falls on this projection adds hours to that week. If
              the projection has no schedule dates, or the activity is not on the projection calendar, it is added
              to Upcoming.
            </p>

            {error ? <div className="banner banner-error">{error}</div> : null}

            {doneLines ? (
              <div className="stack">
                {doneLines.map((line) => (
                  <p key={line} className="gc-schedule-done">
                    {line}
                  </p>
                ))}
                <div className="row gap">
                  <button type="button" className="btn btn-primary btn-small" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
            ) : !parsed ? (
              <div
                className={`gc-schedule-drop${dragOver ? " is-drag" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
              >
                <p className="gc-schedule-drop-title">{reading ? readingLabel : "Drop the GC schedule here"}</p>
                <p className="muted small">PDF, Excel, CSV, or P6. Scanned PDFs are read with AI.</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={reading}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose file
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xlsm,.xls,.csv,.xer,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void readFile(file);
                  }}
                />
              </div>
            ) : parsed.activities.length === 0 ? (
              <div className="stack">
                <p>
                  No paint or wallcovering activities found in {parsed.sourceLabel}. Scanned {parsed.scanned} rows.
                </p>
                <p className="muted small">
                  Activity names need words like paint, painting, primer, or wallcovering.
                </p>
                <button type="button" className="btn btn-secondary btn-small" onClick={resetFile}>
                  Try another file
                </button>
              </div>
            ) : (
              <div className="stack">
                <div className="row-between wrap gap">
                  <p className="muted small">
                    Found {parsed.activities.length} in {parsed.sourceLabel} · scanned {parsed.scanned} rows
                  </p>
                  <span className="row gap">
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setAll(true)}>
                      Use all
                    </button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setAll(false)}>
                      Use none
                    </button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={resetFile}>
                      Different file
                    </button>
                  </span>
                </div>
                <label className="gc-schedule-place-option">
                  <input
                    type="checkbox"
                    checked={placeActivities}
                    disabled={applying}
                    onChange={(event) => setPlaceActivities(event.target.checked)}
                  />
                  Set hours and where it goes
                </label>
                <div className="gc-schedule-scroll">
                  <table className="gc-schedule-table">
                    <thead>
                      <tr>
                        <th>Use</th>
                        <th>Activity</th>
                        <th>Trade</th>
                        <th>GC dates</th>
                        <th>Hours</th>
                        <th>Where it goes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ activity, draft, placement }) => {
                        if (!draft) return null;
                        const tradePhases = phasesForTrade(phases, draft.trade);
                        return (
                          <tr key={activity.key} className={placement.blocked ? "is-blocked" : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Use ${activity.name}`}
                                checked={draft.use && !placement.blocked}
                                disabled={placement.blocked || applying}
                                onChange={(event) => setDraft(activity.key, { use: event.target.checked })}
                              />
                            </td>
                            <td>
                              <span className="gc-schedule-name">{activity.name}</span>
                              {activity.activityId ? (
                                <span className="muted small gc-schedule-id">{activity.activityId}</span>
                              ) : null}
                              {activity.alsoPaint ? (
                                <span className="muted small gc-schedule-id">Also mentions paint</span>
                              ) : null}
                            </td>
                            <td>
                              <select
                                aria-label={`Trade for ${activity.name}`}
                                value={draft.trade}
                                disabled={applying}
                                onChange={(event) => setTrade(activity, event.target.value as GcTrade)}
                              >
                                <option value="paint">Paint</option>
                                <option value="wallcovering">Wallcovering</option>
                              </select>
                            </td>
                            <td>
                              <span>{dateLabel(activity.startIso)}</span>
                              {activity.finishIso && activity.finishIso !== activity.startIso ? (
                                <span className="muted small gc-schedule-id">through {dateLabel(activity.finishIso)}</span>
                              ) : null}
                              {activity.durationLabel ? (
                                <span className="muted small gc-schedule-id">{activity.durationLabel}</span>
                              ) : null}
                            </td>
                            <td>
                              {placeActivities && placement.destination === "projection" ? (
                                <input
                                  className="gc-schedule-hours"
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  aria-label={`Hours for ${activity.name}`}
                                  value={draft.hours}
                                  disabled={applying}
                                  onChange={(event) => setDraft(activity.key, { hours: event.target.value })}
                                />
                              ) : (
                                <span className="muted small">—</span>
                              )}
                            </td>
                            <td>
                              {placeActivities ? (
                                <>
                                  <span className="gc-schedule-note">{placement.note}</span>
                                  {placement.destination === "projection" && tradePhases.length > 1 ? (
                                    <select
                                      aria-label={`Cost code for ${activity.name}`}
                                      value={draft.phaseId}
                                      disabled={applying}
                                      onChange={(event) => setDraft(activity.key, { phaseId: event.target.value })}
                                    >
                                      {tradePhases.map((phase) => (
                                        <option key={phase.id} value={phase.id}>
                                          {phaseDisplayLabel(phase)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                </>
                              ) : (
                                <span className="muted small">Not set</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="row-between wrap gap">
                  <p className="muted small">
                    {placeActivities
                      ? `${projectionCount} to the projection${needsHours ? ` · ${needsHours} need hours` : ""} · ${upcomingCount} to Upcoming`
                      : "Checked activities are saved on the GC schedule tab. Hours and where it goes stay unset."}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={
                      busy ||
                      chosen.length === 0 ||
                      (placeActivities && projectionCount === 0 && upcomingCount === 0)
                    }
                    onClick={() => void apply()}
                  >
                    {applying ? "Saving…" : placeActivities ? "Use selected" : "Save list"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
