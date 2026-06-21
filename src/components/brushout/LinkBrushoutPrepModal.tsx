import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/strings";
import type { BrushoutPrepRecord } from "../../lib/paintUserSettings";
import type { Project } from "../../types/database";

type Props = {
  prep: BrushoutPrepRecord;
  onLink: (projectId: string, mergeMode: "replace" | "append") => void;
  onClose: () => void;
};

export function LinkBrushoutPrepModal({ prep, onLink, onClose }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [mergeMode, setMergeMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      setProjects(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (prep.status === "linked") {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
          <h3>Already linked</h3>
          <p className="muted">
            Prep {prep.prep_id} is already linked to a project.
            {prep.linked_job_key ? ` (project id: ${prep.linked_job_key})` : ""}
          </p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack paint-prep-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Link prep to job</h3>
        <p className="muted small">
          Select the project to receive these paint lines ({prep.line_count ?? prep.paint_items?.length ?? 0}{" "}
          line(s) from {prep.prep_id}). Only paint line data is copied into Paint submittals.
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        {loading ? (
          <p className="muted">Loading projects…</p>
        ) : !projects.length ? (
          <p className="muted">No projects yet. Create a project first, then link this prep.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table compact selectable">
              <thead>
                <tr>
                  <th />
                  <th>Job #</th>
                  <th>Name</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className={selectedId === p.id ? "selected" : ""}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <td>
                      <input
                        type="radio"
                        name="link-project"
                        checked={selectedId === p.id}
                        onChange={() => setSelectedId(p.id)}
                      />
                    </td>
                    <td>{p.job_number}</td>
                    <td>{p.job_name}</td>
                    <td className="muted small">{formatDateTime(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row-gap">
          <label className="check">
            <input type="radio" checked={mergeMode === "replace"} onChange={() => setMergeMode("replace")} />
            Replace existing paint lines
          </label>
          <label className="check">
            <input type="radio" checked={mergeMode === "append"} onChange={() => setMergeMode("append")} />
            Append to existing lines
          </label>
        </div>

        <div className="row-gap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selectedId}
            onClick={() => onLink(selectedId, mergeMode)}
          >
            Link
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
