import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { wcTrackerJobNumber } from "../../lib/jobInfo";
import {
  reloadProject,
  resolveWcTrackerLines,
  saveWcTrackerLines,
} from "../../lib/fieldTrackerProject";
import {
  applyWcLineStage,
  WC_LINE_STAGES,
  wcFieldStatus,
  wcOverallStatus,
  wcPillClass,
  wcStatusLabel,
  type WcFieldStatus,
} from "../../lib/fieldTrackerStatus";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import { createEmptyWcTrackerLine, type WcTrackerLineState } from "../../types/fieldTracker";
import type { ProjectForm, Json } from "../../types/database";
import { WcTrackerLineInlineEditor } from "./WcTrackerLineInlineEditor";

type Props = {
  project: ProjectForm;
  projectId: string;
  onOpenJobSetup?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
};

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

export function WcTrackerStatusSection({ project, projectId, onOpenJobSetup, onProjectUpdate }: Props) {
  const [lines, setLines] = useState<WcTrackerLineState[]>([]);
  const [loading, setLoading] = useState(true);
  const [lineSaving, setLineSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** In-place row editor: mode "edit" expands an existing row; "add" appends a draft row. */
  const [editing, setEditing] = useState<{ mode: "add" | "edit"; line: WcTrackerLineState } | null>(null);

  const jobNumber = wcTrackerJobNumber(project);

  const resolved = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolveWcTrackerLines(trade);
  }, [project.data]);

  useEffect(() => {
    setLines(resolved);
    setLoading(false);
  }, [resolved]);

  const overallStatus = useMemo(() => wcOverallStatus(lines), [lines]);

  const persistLines = useCallback(
    async (nextLines: WcTrackerLineState[], summary = "Wallcovering tracker updated") => {
      setLineSaving(true);
      setError(null);

      const cloudErr = await saveWcTrackerLines(projectId, nextLines, summary);

      setLineSaving(false);
      if (cloudErr) {
        setError(cloudErr);
        return false;
      }
      setLines(nextLines);
      const next = await reloadProject(projectId);
      if (next) onProjectUpdate?.(next);
      return true;
    },
    [onProjectUpdate, projectId],
  );

  function openAdd() {
    setEditing({ mode: "add", line: createEmptyWcTrackerLine() });
  }

  /** Row click / chevron: expand this row's editor (closing any other), or collapse it. */
  function toggleRow(line: WcTrackerLineState) {
    if (lineSaving) return;
    if (editing?.mode === "edit" && editing.line.id === line.id) {
      setEditing(null);
      return;
    }
    setEditing({ mode: "edit", line: { ...line } });
  }

  function closeEditor() {
    if (lineSaving) return;
    setEditing(null);
  }

  async function onEditorSave() {
    if (!editing) return;
    const draftLine = editing.line;
    const label = draftLine.label.trim();
    const name = draftLine.wallcoveringName.trim();
    if (!label && !name) {
      setError("Enter a label or wallcovering name.");
      return;
    }
    if (draftLine.revision && !draftLine.revisionNotes.trim()) {
      setError("Enter revision notes for this wallcovering before saving.");
      return;
    }

    const nextLines =
      editing.mode === "add"
        ? [...lines, draftLine]
        : lines.map((l) => (l.id === draftLine.id ? draftLine : l));

    const lineLabel = draftLine.label.trim() || draftLine.wallcoveringName.trim() || "Line";
    const summary =
      editing.mode === "add"
        ? `Added wallcovering line: ${lineLabel}`
        : `Updated wallcovering line: ${lineLabel}`;

    const ok = await persistLines(nextLines, summary);
    if (ok) setEditing(null);
  }

  async function onLineStageChange(line: WcTrackerLineState, stage: WcFieldStatus) {
    const nextLine = applyWcLineStage(line, stage);
    if (stage === "Needs Revision" && !nextLine.revisionNotes.trim()) {
      setEditing({ mode: "edit", line: nextLine });
      setError("Add revision notes for this wallcovering, then save the line.");
      return;
    }
    const nextLines = lines.map((l) => (l.id === line.id ? nextLine : l));
    const label = line.label.trim() || line.wallcoveringName.trim() || "Line";
    await persistLines(nextLines, `Wallcovering line status: ${label} → ${wcStatusLabel(stage)}`);
  }

  async function onEditorDelete() {
    if (!editing || editing.mode !== "edit") return;
    const draftLine = editing.line;
    const label = draftLine.label.trim() || draftLine.wallcoveringName.trim() || "this line";
    if (!window.confirm(`Delete "${label}" from this job?`)) return;
    const nextLines = lines.filter((l) => l.id !== draftLine.id);
    const ok = await persistLines(nextLines);
    if (ok) setEditing(null);
  }

  const isAdding = editing?.mode === "add";
  const expandedId = editing?.mode === "edit" ? editing.line.id : null;

  const editorRow = editing ? (
    <tr className="wc-tracker-editor-row">
      <td colSpan={6}>
        <WcTrackerLineInlineEditor
          line={editing.line}
          mode={editing.mode}
          saving={lineSaving}
          onChange={(next) => setEditing((cur) => (cur ? { ...cur, line: next } : cur))}
          onSave={() => void onEditorSave()}
          onCancel={closeEditor}
          onDelete={editing.mode === "edit" ? () => void onEditorDelete() : undefined}
        />
      </td>
    </tr>
  ) : null;

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
  } else if (loading) {
    body = <p className="muted small">Loading wallcovering tracker…</p>;
  } else {
    body = (
      <>
        <div className="wc-tracker-overall-status" aria-label="Overall wallcovering status">
          <span className="muted small">Overall status</span>
          <span className={`pill ${wcPillClass(overallStatus)}`}>{wcStatusLabel(overallStatus)}</span>
          <span className="muted small">
            Based on the least-advanced of {lines.length} material{lines.length === 1 ? "" : "s"}
          </span>
        </div>
        {!lines.length && !isAdding ? (
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
            <div className="row-between wrap wc-tracker-list-toolbar">
              <span className="muted small">
                {lines.length} material{lines.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={lineSaving || isAdding}
                onClick={openAdd}
              >
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
                    const fieldStatus = wcFieldStatus(line);
                    const isOpen = expandedId === line.id;
                    const lineName = line.label.trim() || line.wallcoveringName.trim() || "line";
                    return (
                      <Fragment key={line.id}>
                        <tr
                          className={`wc-tracker-line-row${isOpen ? " wc-tracker-line-row--open" : ""}`}
                          onClick={() => toggleRow(line)}
                        >
                          <td>{line.label.trim() || "—"}</td>
                          <td>
                            {line.wallcoveringName.trim() || "—"}
                            {line.panels && " ⚠️"}
                          </td>
                          {/* Status stays editable in the collapsed row; don't let it toggle the expand. */}
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              className={`wc-tracker-status-select pill ${wcPillClass(fieldStatus)}`}
                              value={fieldStatus}
                              disabled={lineSaving}
                              aria-label={`Status for ${lineName}`}
                              onChange={(e) => void onLineStageChange(line, e.target.value as WcFieldStatus)}
                            >
                              {WC_LINE_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {wcStatusLabel(s)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{formatListDate(line.installDate)}</td>
                          <td>{formatListDate(line.dateOrdered)}</td>
                          <td className="wc-tracker-list-actions">
                            <button
                              type="button"
                              className={`wc-tracker-row-chevron${isOpen ? " wc-tracker-row-chevron--open" : ""}`}
                              disabled={lineSaving}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? `Close editor for ${lineName}` : `Edit ${lineName}`}
                              title={isOpen ? "Close editor" : "Edit line"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(line);
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="M9 6l6 6-6 6" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                        {isOpen && editorRow}
                      </Fragment>
                    );
                  })}
                  {isAdding && editorRow}
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
    </div>
  );
}
