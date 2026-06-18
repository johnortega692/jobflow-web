import { FormEvent, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateTime } from "../lib/strings";
import type { ProjectForm, Submittal } from "../types/database";
import {
  SUBMITTAL_RESULTS,
  SUBMITTAL_SCOPES,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
} from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

const emptyRow = (projectId: string, line: string): Omit<Submittal, "id" | "created_at" | "updated_at" | "created_by"> => ({
  project_id: projectId,
  line_number: line,
  description: "",
  spec_section: "",
  submittal_type: "",
  scope: "",
  status: "Draft",
  result_code: "",
  data: {},
});

export function SubmittalsPage() {
  const { projectId } = useOutletContext<Ctx>();
  const [rows, setRows] = useState<Submittal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("submittals")
      .select("*")
      .eq("project_id", projectId)
      .order("line_number", { ascending: true });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRows(data ?? []);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function addRow() {
    const nextLine = String(rows.length + 1).padStart(2, "0");
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("submittals").insert({
      ...emptyRow(projectId, nextLine),
      created_by: userData.user?.id ?? null,
    });
    if (err) setError(err.message);
    else await load();
  }

  async function saveRow(e: FormEvent, row: Submittal) {
    e.preventDefault();
    setSavingId(row.id);
    const { error: err } = await supabase
      .from("submittals")
      .update({
        line_number: row.line_number,
        description: row.description,
        spec_section: row.spec_section,
        submittal_type: row.submittal_type,
        scope: row.scope,
        status: row.status,
        result_code: row.result_code,
      })
      .eq("id", row.id);
    setSavingId(null);
    if (err) setError(err.message);
    else await load();
  }

  function patchRow(id: string, patch: Partial<Submittal>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div>
          <h2>Submittal log</h2>
          <p className="muted small">ICBI-style log — aligned with desktop Submittal Log tab.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void addRow()}>
          Add row
        </button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading submittals…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No submittal rows yet. Add one to start tracking.</p>
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <form key={row.id} className="submittal-row card stack" onSubmit={(e) => void saveRow(e, row)}>
              <div className="grid-3">
                <label>
                  Line #
                  <input
                    value={row.line_number}
                    onChange={(e) => patchRow(row.id, { line_number: e.target.value })}
                  />
                </label>
                <label>
                  Spec section
                  <input
                    value={row.spec_section}
                    onChange={(e) => patchRow(row.id, { spec_section: e.target.value })}
                  />
                </label>
                <label>
                  Scope
                  <select
                    value={row.scope}
                    onChange={(e) => patchRow(row.id, { scope: e.target.value })}
                  >
                    {SUBMITTAL_SCOPES.map((s) => (
                      <option key={s || "blank"} value={s}>
                        {s || "—"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Description
                <input
                  value={row.description}
                  onChange={(e) => patchRow(row.id, { description: e.target.value })}
                />
              </label>
              <div className="grid-3">
                <label>
                  Type
                  <select
                    value={row.submittal_type}
                    onChange={(e) => patchRow(row.id, { submittal_type: e.target.value })}
                  >
                    {SUBMITTAL_TYPES.map((t) => (
                      <option key={t || "blank"} value={t}>
                        {t || "—"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={row.status}
                    onChange={(e) => patchRow(row.id, { status: e.target.value })}
                  >
                    {SUBMITTAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Result
                  <select
                    value={row.result_code}
                    onChange={(e) => patchRow(row.id, { result_code: e.target.value })}
                  >
                    {SUBMITTAL_RESULTS.map((r) => (
                      <option key={r || "blank"} value={r}>
                        {r || "—"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row-between">
                <span className="muted small">Updated {formatDateTime(row.updated_at)}</span>
                <button type="submit" className="btn btn-secondary btn-small" disabled={savingId === row.id}>
                  {savingId === row.id ? "Saving…" : "Save row"}
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
