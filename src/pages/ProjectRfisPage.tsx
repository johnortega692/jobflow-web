import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateTime } from "../lib/strings";
import type { ProjectForm, Rfi } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

export function ProjectRfisPage() {
  const { projectId } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("rfis")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (err) setError(err.message);
    else setRfis(data ?? []);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function createRfi() {
    const nextNum = String(rfis.length + 1).padStart(3, "0");
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("rfis")
      .insert({
        project_id: projectId,
        rfi_number: nextNum,
        subject: "New RFI",
        created_by: userData.user?.id ?? null,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    navigate(`/projects/${projectId}/rfis/${data.id}`);
  }

  return (
    <section className="card">
      <div className="row-between" style={{ marginBottom: "1rem" }}>
        <h2>RFIs</h2>
        <button type="button" className="btn btn-primary" onClick={() => void createRfi()}>
          New RFI
        </button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading RFIs…</p>
      ) : rfis.length === 0 ? (
        <p className="muted">No RFIs yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rfis.map((r) => (
                <tr key={r.id}>
                  <td>{r.rfi_number}</td>
                  <td>{r.subject}</td>
                  <td>{r.status}</td>
                  <td className="muted">{formatDateTime(r.updated_at)}</td>
                  <td>
                    <Link className="btn btn-small" to={`/projects/${projectId}/rfis/${r.id}`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
