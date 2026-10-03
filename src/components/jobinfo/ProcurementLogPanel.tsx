import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { buildProcurementLogRowsFromLines } from "../../lib/procurementLog";
import { downloadProcurementLogPdf } from "../../lib/procurementLogPrint";
import { procurementLogFilename } from "../../lib/pdfFilenames";
import { projectHasWallcovering, wcTrackerJobName, wcTrackerJobNumber } from "../../lib/jobInfo";
import { resolveWcTrackerLines } from "../../lib/fieldTrackerProject";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import type { ProjectForm, Json } from "../../types/database";

type Props = {
  project: ProjectForm;
  projectId: string;
};

/** Read-only procurement log built from wallcovering tracker lines, with branded PDF export. */
export function ProcurementLogPanel({ project, projectId }: Props) {
  const { branding } = useLetterhead();
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasWallcovering = projectHasWallcovering(project.jobInfo);
  const jobNumber = wcTrackerJobNumber(project);
  const jobName = wcTrackerJobName(project);

  const trackerLines = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolveWcTrackerLines(trade);
  }, [project.data]);

  const logRows = useMemo(() => buildProcurementLogRowsFromLines(trackerLines), [trackerLines]);
  const pdfFilename = procurementLogFilename(jobName, jobNumber);
  const lastUpdateLabel = loadedAt
    ? `${loadedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, ${loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${logRows.length} material${logRows.length === 1 ? "" : "s"}`
    : "—";

  useEffect(() => {
    setLoadedAt(new Date());
  }, [project.data]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrolled(el.scrollLeft > 0);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [hasWallcovering, logRows.length]);

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
        <p className="muted small procurement-log-last-update">Last Update: {lastUpdateLabel}</p>
        <div className="row-gap wrap">
          <span className="procurement-log-export" title={`Filename: ${pdfFilename}`}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={printing || !logRows.length}
              onClick={() => void onExportPdf()}
            >
              {printing ? "Exporting…" : "Export PDF"}
            </button>
          </span>
        </div>
      </div>

      {!jobNumber && (
        <p className="banner banner-warn">
          Add a wallcovering job number in{" "}
          <Link to={`/projects/${projectId}`}>job setup</Link> for the PDF header.
        </p>
      )}

      <section className="card procurement-log-meta">
        <p className="procurement-log-meta-line">
          <span>
            <strong>Job Number:</strong> {jobNumber || "—"}
          </span>
          <span>
            <strong>Project:</strong> {jobName || "—"}
          </span>
        </p>
      </section>

      <section className="card procurement-log-table-wrap">
        <h2 className="procurement-log-table-title">Procurement Log</h2>
        {logRows.length === 0 ? (
          <p className="muted procurement-log-empty">
            No wallcovering materials yet. Add lines in the <strong>Wallcovering</strong> tab, or copy from the
            submittal.
          </p>
        ) : (
          <div
            ref={scrollRef}
            className={`procurement-log-scroll${scrolled ? " is-scrolled" : ""}`}
          >
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
                  <th>Lead (wks)</th>
                  <th>Approved</th>
                  <th>Ordered</th>
                  <th>Shipped</th>
                  <th>Received / Tracking</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row, i) => (
                  <tr key={`${row.finish}-${row.product}-${i}`}>
                    <td>{row.finish}</td>
                    <td>{row.product}</td>
                    <td>{row.leadTime}</td>
                    <td>{row.approvalReceived}</td>
                    <td>{row.dateOrdered}</td>
                    <td>{row.shipDate}</td>
                    <td className="plog-tracking-cell" title={row.dateReceivedTracking}>
                      {row.dateReceivedTracking}
                    </td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
