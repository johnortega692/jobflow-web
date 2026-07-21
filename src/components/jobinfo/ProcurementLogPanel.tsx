import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { buildProcurementLogRowsFromLines } from "../../lib/procurementLog";
import { downloadProcurementLogPdf } from "../../lib/procurementLogPrint";
import { procurementLogFilename } from "../../lib/pdfFilenames";
import { projectHasWallcovering, wcTrackerJobName, wcTrackerJobNumber } from "../../lib/jobInfo";
import { reloadProject, resolveWcTrackerLines } from "../../lib/fieldTrackerProject";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import type { ProjectForm, Json } from "../../types/database";

type Props = {
  project: ProjectForm;
  projectId: string;
  onProjectUpdate?: (project: ProjectForm) => void;
};

/** Read-only procurement log (WC tracker lines) with Refresh + branded PDF export. */
export function ProcurementLogPanel({ project, projectId, onProjectUpdate }: Props) {
  const { branding } = useLetterhead();
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const hasWallcovering = projectHasWallcovering(project.jobInfo);
  const jobNumber = wcTrackerJobNumber(project);
  const jobName = wcTrackerJobName(project);

  const trackerLines = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolveWcTrackerLines(trade);
  }, [project.data]);

  const logRows = useMemo(() => buildProcurementLogRowsFromLines(trackerLines), [trackerLines]);
  const pdfFilename = procurementLogFilename(jobName, jobNumber);

  useEffect(() => {
    setLoadedAt(new Date());
  }, [project.data]);

  const refreshFromDatabase = useCallback(async () => {
    const next = await reloadProject(projectId);
    if (next) {
      onProjectUpdate?.(next);
      setLoadedAt(new Date());
    }
    return next;
  }, [projectId, onProjectUpdate]);

  const onRefresh = useCallback(async () => {
    if (!hasWallcovering) return;
    setRefreshing(true);
    setError(null);
    const next = await refreshFromDatabase();
    setRefreshing(false);
    if (!next) setError("Could not reload project data.");
  }, [hasWallcovering, refreshFromDatabase]);

  async function onExportPdf() {
    if (!logRows.length) {
      setError("No materials to export. Add wallcovering lines in the Wallcovering tab first.");
      return;
    }
    setPrinting(true);
    setError(null);
    try {
      await downloadProcurementLogPdf({
        jobNumber,
        jobName,
        lines: trackerLines,
        branding,
        lastUpdate: loadedAt ?? undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed.");
    } finally {
      setPrinting(false);
    }
  }

  if (!hasWallcovering) {
    return (
      <p className="banner banner-warn">
        Enable <strong>Wallcovering</strong> in{" "}
        <Link to={`/projects/${projectId}`}>job setup</Link> to use the procurement log.
      </p>
    );
  }

  return (
    <div className="stack procurement-log-page">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="row-between wrap">
        <p className="sds-filename-preview muted small">
          Filename: <code>{pdfFilename}</code>
        </p>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
            onClick={() => void onRefresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={refreshing || printing || !logRows.length}
            onClick={() => void onExportPdf()}
          >
            {printing ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </div>

      {!jobNumber && (
        <p className="banner banner-warn">
          Add a wallcovering job number in{" "}
          <Link to={`/projects/${projectId}`}>job setup</Link> for the PDF header.
        </p>
      )}

      <section className="card stack procurement-log-meta">
        <p>
          <strong>Job Number:</strong> {jobNumber || "—"}
        </p>
        <p>
          <strong>Project:</strong> {jobName || "—"}
        </p>
        <p>
          <strong>Last Update:</strong>{" "}
          {loadedAt
            ? `${loadedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, ${loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${logRows.length} material${logRows.length === 1 ? "" : "s"}`
            : "—"}
        </p>
      </section>

      <section className="card procurement-log-table-wrap">
        <h2 className="procurement-log-table-title">Procurement Log</h2>
        {refreshing ? (
          <p className="muted">Loading tracker data…</p>
        ) : (
          <div className="procurement-log-scroll">
            <table className="procurement-log-table">
              <colgroup>
                <col className="plog-col-finish" />
                <col className="plog-col-product" />
                <col className="plog-col-lead" />
                <col className="plog-col-date" />
                <col className="plog-col-date" />
                <col className="plog-col-ship" />
                <col className="plog-col-tracking" />
                <col className="plog-col-notes" />
              </colgroup>
              <thead>
                <tr>
                  <th>Finish</th>
                  <th>Product</th>
                  <th>Lead Time in Weeks</th>
                  <th>Approval Received</th>
                  <th>Date Ordered</th>
                  <th>Ship Date</th>
                  <th>Date Received / Tracking</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted procurement-log-empty">
                      No wallcovering materials yet. Add lines in the <strong>Wallcovering</strong> tab, or
                      copy from the submittal.
                    </td>
                  </tr>
                ) : (
                  logRows.map((row, i) => (
                    <tr key={`${row.finish}-${row.product}-${i}`}>
                      <td>{row.finish}</td>
                      <td>{row.product}</td>
                      <td>{row.leadTime}</td>
                      <td>{row.approvalReceived}</td>
                      <td>{row.dateOrdered}</td>
                      <td>{row.shipDate}</td>
                      <td>{row.dateReceivedTracking}</td>
                      <td>{row.notes}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
