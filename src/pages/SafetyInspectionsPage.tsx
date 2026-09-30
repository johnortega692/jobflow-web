import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatDateTime } from "../lib/strings";
import {
  formatRecordDay,
  loadSafetyInspections,
  type InspectionItem,
  type SafetyInspectionRecord,
} from "../lib/safetyRecords";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

function attentionItems(items: InspectionItem[]): InspectionItem[] {
  return items.filter((item) => item.status === "attention");
}

export function SafetyInspectionsPage() {
  const { projectId } = useOutletContext<Ctx>();
  const [records, setRecords] = useState<SafetyInspectionRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadSafetyInspections(projectId).then((result) => {
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
      <p className="muted small">Saved and submitted inspections from Field Tools for this job.</p>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted small">Loading inspections…</p>
      ) : records.length === 0 ? (
        <p className="muted">No safety inspections have been saved for this job yet.</p>
      ) : (
        <div className="stack">
          {records.map((record) => {
            const open = openId === record.id;
            const flagged = attentionItems(record.items);
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
                    <span className="job-activity-action">Week ending {formatRecordDay(record.weekEnding)}</span>
                  </div>
                  <div className="job-activity-meta muted small">
                    {record.status === "saved" ? "Saved" : "Submitted"} · {record.inspectorName || record.submittedByName} ·{" "}
                    {formatDateTime(record.updatedAt)} ·{" "}
                    {record.okCount} OK · {record.attentionCount} need attention · {record.naCount} N/A
                  </div>
                </button>
                {open && (
                  <div className="stack" style={{ marginTop: "0.65rem" }}>
                    {record.accidentAttached && <p className="muted small">Accident investigation attached.</p>}
                    {flagged.length === 0 ? (
                      <p className="muted small">Nothing marked as needing attention.</p>
                    ) : (
                      flagged.map((item) => (
                        <div key={`${item.section}-${item.name}`}>
                          <div className="job-activity-action">
                            {item.section} · {item.name}
                          </div>
                          <div className="muted small">
                            {item.party || "ICBI"}
                            {item.notes ? ` · ${item.notes}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                    {record.otherConcerns ? <p>{record.otherConcerns}</p> : null}
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
