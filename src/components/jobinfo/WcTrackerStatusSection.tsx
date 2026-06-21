import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { wcTrackerJobNumber } from "../../lib/jobInfo";
import {
  reloadProject,
  resolveWcTrackerLines,
  saveWcTrackerLines,
} from "../../lib/fieldTrackerProject";
import {
  wcFieldStatus,
  wcPillClass,
  wcStatusLabel,
} from "../../lib/fieldTrackerStatus";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import { createEmptyWcTrackerLine, type WcTrackerLineState } from "../../types/fieldTracker";
import type { ProjectForm, Json } from "../../types/database";
import { WcTrackerLineEditorDrawer } from "./WcTrackerLineEditorDrawer";

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
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("edit");
  const [draftLine, setDraftLine] = useState<WcTrackerLineState | null>(null);

  const jobNumber = wcTrackerJobNumber(project);

  const resolvedLines = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolveWcTrackerLines(trade);
  }, [project.data]);

  useEffect(() => {
    setLines(resolvedLines);
    setLoading(false);
  }, [resolvedLines]);

  const fromSubmittalOnly = useMemo(
    () => resolvedLines.length > 0 && resolvedLines.every((l) => l.id.startsWith("submittal-")),
    [resolvedLines],
  );

  const persistLines = useCallback(
    async (nextLines: WcTrackerLineState[], summary = "Wallcovering tracker updated") => {
      setSaving(true);
      setError(null);
      setStatus(null);

      const cloudErr = await saveWcTrackerLines(projectId, nextLines, summary);

      setSaving(false);
      if (cloudErr) {
        setError(cloudErr);
        return false;
      }
      setLines(nextLines);
      setStatus("Wallcovering line saved.");
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
    if (saving) return;
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
        to manage wallcovering tracker lines.
      </p>
    );
  } else if (loading) {
    body = <p className="muted small">Loading wallcovering tracker…</p>;
  } else if (!lines.length) {
    body = (
      <>
        <p className="muted small">
          No wallcovering materials yet. Add lines here or copy from the{" "}
          <Link to={`/projects/${projectId}/wallcovering`}>Wallcovering</Link> submittal.
        </p>
        <div className="row-gap wrap paint-tracker-toolbar">
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            Add line
          </button>
        </div>
      </>
    );
  } else {
    body = (
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
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={openAdd}>
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
                        disabled={saving}
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
    );
  }

  return (
    <div className="stack paint-tracker-section paint-tracker-section--dashboard">
      {(error || status) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? status}</div>
      )}
      {body}

      <WcTrackerLineEditorDrawer
        open={drawerOpen}
        line={draftLine}
        mode={drawerMode}
        saving={saving}
        onClose={closeDrawer}
        onChange={setDraftLine}
        onSave={() => void onDrawerSave()}
        onDelete={drawerMode === "edit" ? () => void onDrawerDelete() : undefined}
      />
    </div>
  );
}
