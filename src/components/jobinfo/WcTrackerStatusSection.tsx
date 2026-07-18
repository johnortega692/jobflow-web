import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DateInput } from "../DateInput";
import { addDaysToTodayDisplay } from "../../lib/dateInputUtils";
import { wcTrackerJobNumber } from "../../lib/jobInfo";
import {
  reloadProject,
  resolveWcTracker,
  resolveWcTrackerLines,
  saveWcTrackerLines,
  saveWcTrackerState,
} from "../../lib/fieldTrackerProject";
import {
  applyTrackerRevisionPatch,
  validateTrackerRevisionSave,
} from "../../lib/paintTrackerRevision";
import { wcFieldStatus, wcPillClass, wcStatusLabel } from "../../lib/fieldTrackerStatus";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import { createEmptyWcTrackerLine, type WcTrackerLineState, type WcTrackerState } from "../../types/fieldTracker";
import type { ProjectForm, Json } from "../../types/database";
import { WcTrackerLineEditorDrawer } from "./WcTrackerLineEditorDrawer";

type Props = {
  project: ProjectForm;
  projectId: string;
  onOpenJobSetup?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
};

const AUTO_SAVE_MS = 700;

function StatusPill({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`job-status-pill${on ? " job-status-pill--on" : ""}`}>{label}</span>
  );
}

function TrackerCheckbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox-row paint-tracker-flag">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function formatListDate(value: string): string {
  const v = value.trim();
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    }
  }
  return v;
}

function trackerSnapshot(tracker: WcTrackerState): string {
  return JSON.stringify(tracker);
}

export function WcTrackerStatusSection({ project, projectId, onOpenJobSetup, onProjectUpdate }: Props) {
  const [tracker, setTracker] = useState<WcTrackerState | null>(null);
  const [lines, setLines] = useState<WcTrackerLineState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lineSaving, setLineSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("edit");
  const [draftLine, setDraftLine] = useState<WcTrackerLineState | null>(null);

  const lastSavedRef = useRef<WcTrackerState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const trackerRef = useRef<WcTrackerState | null>(null);
  const revisionNotesRef = useRef<HTMLTextAreaElement | null>(null);

  const jobNumber = wcTrackerJobNumber(project);

  const resolved = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return {
      tracker: resolveWcTracker(trade),
      lines: resolveWcTrackerLines(trade),
    };
  }, [project.data]);

  useEffect(() => {
    setTracker(resolved.tracker);
    setLines(resolved.lines);
    lastSavedRef.current = resolved.tracker;
    trackerRef.current = resolved.tracker;
    setLoading(false);
  }, [resolved]);

  useEffect(() => {
    trackerRef.current = tracker;
  }, [tracker]);

  const fromSubmittalOnly = useMemo(
    () => resolved.lines.length > 0 && resolved.lines.every((l) => l.id.startsWith("submittal-")),
    [resolved.lines],
  );

  const persistTracker = useCallback(
    async (next: WcTrackerState) => {
      setSaving(true);
      setError(null);
      const cloudErr = await saveWcTrackerState(projectId, next);
      setSaving(false);
      if (cloudErr) {
        setError(cloudErr);
        return false;
      }
      setTracker(next);
      const updated = await reloadProject(projectId);
      if (updated) onProjectUpdate?.(updated);
      return true;
    },
    [onProjectUpdate, projectId],
  );

  const flushSave = useCallback(async () => {
    const current = trackerRef.current;
    if (!current) return;
    const prev = lastSavedRef.current ?? resolved.tracker;
    if (trackerSnapshot(prev) === trackerSnapshot(current)) return;

    const revisionError = validateTrackerRevisionSave(current, prev);
    if (revisionError) {
      setError(revisionError);
      revisionNotesRef.current?.focus();
      return;
    }

    const ok = await persistTracker(current);
    if (!ok) return;

    lastSavedRef.current = current;
    setStatus("Saved.");
  }, [persistTracker, resolved.tracker]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, AUTO_SAVE_MS);
  }, [flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  function patchTracker(patch: Partial<WcTrackerState>) {
    const lastSaved = lastSavedRef.current ?? resolved.tracker;
    const hasRevisionPatch = "revisionNotes" in patch || "revision" in patch;

    if (hasRevisionPatch && trackerRef.current) {
      const { next, validationError, scheduleSave: shouldSave } = applyTrackerRevisionPatch(
        trackerRef.current,
        patch,
        lastSaved,
      );
      setTracker(next);
      trackerRef.current = next;
      if (validationError) {
        setError(validationError);
        if ("revision" in patch && patch.revision) {
          revisionNotesRef.current?.focus();
        }
      } else {
        setError(null);
      }
      if (shouldSave) scheduleSave();
      return;
    }

    setTracker((t) => {
      if (!t) return t;
      const next = { ...t, ...patch };
      trackerRef.current = next;
      return next;
    });
    setError(null);
    scheduleSave();
  }

  const persistLines = useCallback(
    async (nextLines: WcTrackerLineState[], summary = "Wallcovering tracker updated") => {
      setLineSaving(true);
      setError(null);
      setStatus(null);

      const cloudErr = await saveWcTrackerLines(projectId, nextLines, summary);

      setLineSaving(false);
      if (cloudErr) {
        setError(cloudErr);
        return false;
      }
      setLines(nextLines);
      setStatus("Material line saved.");
      const next = await reloadProject(projectId);
      if (next) onProjectUpdate?.(next);
      return true;
    },
    [onProjectUpdate, projectId],
  );

  function openAdd() {
    setDraftLine(createEmptyWcTrackerLine());
    setDrawerMode("add");
    setDrawerOpen(true);
  }

  function openEdit(line: WcTrackerLineState) {
    setDraftLine({ ...line });
    setDrawerMode("edit");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (lineSaving) return;
    setDrawerOpen(false);
    setDraftLine(null);
  }

  async function onDrawerSave() {
    if (!draftLine) return;
    const label = draftLine.label.trim();
    const name = draftLine.wallcoveringName.trim();
    if (!label && !name) {
      setError("Enter a label or wallcovering name.");
      return;
    }

    const nextLines =
      drawerMode === "add"
        ? [...lines, draftLine]
        : lines.map((l) => (l.id === draftLine.id ? draftLine : l));

    const lineLabel = draftLine.label.trim() || draftLine.wallcoveringName.trim() || "Line";
    const summary =
      drawerMode === "add"
        ? `Added wallcovering line: ${lineLabel}`
        : `Updated wallcovering line: ${lineLabel}`;

    const ok = await persistLines(nextLines, summary);
    if (ok) {
      setDrawerOpen(false);
      setDraftLine(null);
    }
  }

  async function onDrawerDelete() {
    if (!draftLine || drawerMode !== "edit") return;
    const label = draftLine.label.trim() || draftLine.wallcoveringName.trim() || "this line";
    if (!window.confirm(`Delete "${label}" from this job?`)) return;
    const nextLines = lines.filter((l) => l.id !== draftLine.id);
    const ok = await persistLines(nextLines);
    if (ok) {
      setDrawerOpen(false);
      setDraftLine(null);
    }
  }

  let body: ReactNode;
  if (!jobNumber) {
    body = (
      <p className="muted small">
        Add a wallcovering job number in{" "}
        {onOpenJobSetup ? (
          <button type="button" className="link-btn" onClick={onOpenJobSetup}>
            job setup
          </button>
        ) : (
          "job setup"
        )}{" "}
        to manage wallcovering tracker status.
      </p>
    );
  } else if (loading || !tracker) {
    body = <p className="muted small">Loading wallcovering tracker…</p>;
  } else {
    body = (
      <>
        <div className="job-status-pills" aria-label="Tracker status">
          <StatusPill label="Submittal ordered" on={tracker.submittalOrdered} />
          <StatusPill label="Submitted" on={tracker.submittedForApproval} />
          <StatusPill label="Approved" on={tracker.approved} />
          <StatusPill label="Revision" on={tracker.revision} />
        </div>

        <div className="grid-2">
          <label>
            Follow up
            <DateInput value={tracker.followUp} onChange={(v) => patchTracker({ followUp: v })} />
          </label>
          <label>
            Team
            <input
              value={tracker.creativeTeam}
              disabled={saving}
              onChange={(e) => patchTracker({ creativeTeam: e.target.value })}
            />
          </label>
          <label className="grid-span-2">
            Revision notes
            <textarea
              ref={revisionNotesRef}
              rows={3}
              value={tracker.revisionNotes}
              disabled={saving}
              placeholder={
                tracker.revision
                  ? "Required for Field View — describe what needs revision"
                  : "Enter notes before checking Revision for Field View"
              }
              onChange={(e) => patchTracker({ revisionNotes: e.target.value })}
            />
          </label>
        </div>

        <p className="muted small paint-tracker-subsection">Submittal status</p>
        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Submittal ordered"
            checked={tracker.submittalOrdered}
            disabled={saving}
            onChange={(v) => patchTracker({ submittalOrdered: v })}
          />
          <TrackerCheckbox
            label="Submitted for approval"
            checked={tracker.submittedForApproval}
            disabled={saving}
            onChange={(v) =>
              patchTracker(
                v
                  ? { submittedForApproval: true, followUp: addDaysToTodayDisplay(14) }
                  : { submittedForApproval: false },
              )
            }
          />
          <TrackerCheckbox
            label="Revision"
            checked={tracker.revision}
            disabled={saving}
            onChange={(v) => patchTracker({ revision: v })}
          />
          <TrackerCheckbox
            label="Approved"
            checked={tracker.approved}
            disabled={saving}
            onChange={(v) => patchTracker({ approved: v })}
          />
        </div>

        <p className="muted small">
          Enter revision notes before checking <strong>Revision</strong> for Field View. Submittal changes save
          automatically.
          {saving ? " Saving…" : status ? ` ${status}` : ""}
        </p>

        <p className="muted small paint-tracker-subsection">Materials</p>
        {!lines.length ? (
          <>
            <p className="muted small">
              No wallcovering materials yet. Add lines here or copy from the{" "}
              <Link to={`/projects/${projectId}/submittals/wallcovering`}>Wallcovering</Link> submittal.
            </p>
            <div className="row-gap wrap paint-tracker-toolbar">
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                Add line
              </button>
            </div>
          </>
        ) : (
          <>
            {fromSubmittalOnly && (
              <p className="banner banner-warn">
                Lines from submittal only — open a row to edit and save procurement dates.
              </p>
            )}

            <div className="row-between wrap wc-tracker-list-toolbar">
              <span className="muted small">
                {lines.length} material{lines.length === 1 ? "" : "s"}
              </span>
              <button type="button" className="btn btn-primary btn-sm" disabled={lineSaving} onClick={openAdd}>
                Add line
              </button>
            </div>

            <div className="wc-tracker-list-wrap">
              <table className="wc-tracker-list">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Wallcovering</th>
                    <th>Status</th>
                    <th>Install</th>
                    <th>Ordered</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const fieldStatus = wcFieldStatus(line, tracker);
                    return (
                      <tr key={line.id}>
                        <td>{line.label.trim() || "—"}</td>
                        <td>
                          {line.wallcoveringName.trim() || "—"}
                          {line.panels && " ⚠️"}
                        </td>
                        <td>
                          <span className={`pill ${wcPillClass(fieldStatus)}`}>
                            {wcStatusLabel(fieldStatus)}
                          </span>
                        </td>
                        <td>{formatListDate(line.installDate)}</td>
                        <td>{formatListDate(line.dateOrdered)}</td>
                        <td className="wc-tracker-list-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={lineSaving}
                            onClick={() => openEdit(line)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="stack paint-tracker-section paint-tracker-section--dashboard">
      {error && <div className="banner banner-error">{error}</div>}
      {body}

      <WcTrackerLineEditorDrawer
        open={drawerOpen}
        line={draftLine}
        mode={drawerMode}
        saving={lineSaving}
        onClose={closeDrawer}
        onChange={setDraftLine}
        onSave={() => void onDrawerSave()}
        onDelete={drawerMode === "edit" ? () => void onDrawerDelete() : undefined}
      />
    </div>
  );
}
