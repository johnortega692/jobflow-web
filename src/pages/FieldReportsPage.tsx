import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatDateTime } from "../lib/strings";
import {
  formatRecordDay,
  loadFieldReports,
  yesNoLabel,
  type FieldReportRecord,
} from "../lib/safetyRecords";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

function workerCount(record: FieldReportRecord): number {
  return record.manpower.reduce(
    (sum, row) => sum + row.foremen + row.journeymen + row.apprentices + row.laborers,
    0,
  );
}

function weatherLine(record: FieldReportRecord): string {
  const parts = [
    record.weather.conditions,
    record.weather.temp ? `${record.weather.temp}°F` : "",
    record.weather.wind ? `${record.weather.wind} wind` : "",
    record.weather.precipitation ? `${record.weather.precipitation} precip` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function FieldReportsPage() {
  const { projectId } = useOutletContext<Ctx>();
  const [records, setRecords] = useState<FieldReportRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadFieldReports(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      setError(result.error);
      setRecords(result.records);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="card stack">
      <p className="muted small">Saved and submitted field reports from Field Tools for this job. Photos are not stored.</p>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted small">Loading field reports…</p>
      ) : records.length === 0 ? (
        <p className="muted">No field reports have been saved for this job yet.</p>
      ) : (
        <div className="stack">
          {records.map((record) => {
            const open = openId === record.id;
            const workers = workerCount(record);
            const filledCrew = record.manpower.filter(
              (row) => row.foremen + row.journeymen + row.apprentices + row.laborers + row.hours > 0,
            );
            return (
              <article key={record.id} className="job-activity-item">
                <button
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    color: "inherit",
                    font: "inherit",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  onClick={() => setOpenId(open ? null : record.id)}
                >
                  <div className="job-activity-item-main">
                    <span className="job-activity-action">{formatRecordDay(record.reportDate)}</span>
                  </div>
                  <div className="job-activity-meta muted small">
                    {record.status === "saved" ? "Saved" : "Submitted"} · {record.reportedBy || record.submittedByName}
                    {record.reporterTitle ? `, ${record.reporterTitle}` : ""} · {formatDateTime(record.updatedAt)} ·{" "}
                    {workers} {workers === 1 ? "worker" : "workers"}
                  </div>
                  {!open && record.workPerformed ? (
                    <div className="job-activity-summary">{record.workPerformed}</div>
                  ) : null}
                </button>
                {open && (
                  <div className="stack" style={{ marginTop: "0.65rem" }}>
                    {weatherLine(record) ? <p className="muted small">{weatherLine(record)}</p> : null}
                    {[record.superintendent && `Superintendent: ${record.superintendent}`, record.contractor && `Contractor: ${record.contractor}`, record.location && `Location: ${record.location}`]
                      .filter(Boolean)
                      .map((line) => (
                        <p key={line} className="muted small">
                          {line}
                        </p>
                      ))}
                    {filledCrew.map((row) => (
                      <p key={row.trade} className="muted small">
                        {row.trade}: {row.foremen} foremen · {row.journeymen} journeymen · {row.apprentices} apprentices ·{" "}
                        {row.laborers} laborers · {row.hours} hours
                      </p>
                    ))}
                    {record.materials ? (
                      <div>
                        <div className="job-activity-action">Materials</div>
                        <p>{record.materials}</p>
                      </div>
                    ) : null}
                    {record.workPerformed ? (
                      <div>
                        <div className="job-activity-action">Work performed</div>
                        <p>{record.workPerformed}</p>
                      </div>
                    ) : null}
                    {(record.delays.length > 0 || record.delayNotes) && (
                      <div>
                        <div className="job-activity-action">Delays</div>
                        <p>
                          {[record.delays.join(", "), record.delayNotes].filter(Boolean).join(" — ")}
                        </p>
                      </div>
                    )}
                    <p className="muted small">
                      Toolbox talk {yesNoLabel(record.toolboxTalk)} · Incidents {yesNoLabel(record.incidents)} · PPE / housekeeping{" "}
                      {yesNoLabel(record.ppeHousekeeping)}
                    </p>
                    {record.safetyNotes ? <p>{record.safetyNotes}</p> : null}
                    {record.signDate ? (
                      <p className="muted small">Signed {formatRecordDay(record.signDate)}</p>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
