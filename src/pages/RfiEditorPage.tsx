import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportRfiPdf } from "../lib/api";
import {
  defaultRfiFormData,
  type Project,
  type Rfi,
  type RfiFormData,
} from "../types/database";

function parseRfiData(raw: unknown): RfiFormData {
  const base = defaultRfiFormData();
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...(raw as Partial<RfiFormData>) };
}

export function RfiEditorPage() {
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [rfiNumber, setRfiNumber] = useState("001");
  const [subject, setSubject] = useState("");
  const [form, setForm] = useState<RfiFormData>(defaultRfiFormData());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!projectId || !rfiId) return;
      setLoading(true);
      const [projRes, rfiRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("rfis").select("*").eq("id", rfiId).single(),
      ]);
      setLoading(false);
      if (projRes.error || rfiRes.error) {
        setError(projRes.error?.message ?? rfiRes.error?.message ?? "Load failed");
        return;
      }
      setProject(projRes.data);
      const rfi = rfiRes.data as Rfi;
      setRfiNumber(rfi.rfi_number ?? "001");
      setSubject(rfi.subject ?? "");
      setForm(parseRfiData(rfi.data));
    }
    void load();
  }, [projectId, rfiId]);

  function setField<K extends keyof RfiFormData>(key: K, value: RfiFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!rfiId) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("rfis")
      .update({
        rfi_number: rfiNumber,
        subject,
        data: form,
        status: "draft",
      })
      .eq("id", rfiId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function onExportPdf() {
    if (!project || !rfiId) return;
    if (!subject.trim()) {
      setError("Enter a subject before exporting PDF.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      await exportRfiPdf(
        {
          job_number: project.job_number,
          job_name: project.job_name,
          job_address: project.job_address ?? "",
          job_address2: project.job_address2 ?? "",
          contractor: project.contractor ?? "",
          architect: project.architect ?? "",
          owner: project.owner ?? "",
        },
        {
          rfi_number: rfiNumber,
          subject,
          data: form,
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <p className="muted">Loading RFI…</p>;
  if (!project) return <p className="banner banner-error">{error ?? "Not found"}</p>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/projects">Projects</Link> /{" "}
            <Link to={`/projects/${projectId}`}>{project.job_number}</Link> / RFI {rfiNumber}
          </p>
          <h1>RFI {rfiNumber}</h1>
          <p className="muted">{project.job_name}</p>
        </div>
        <div className="row-gap">
          {savedAt && <span className="muted small">Saved {savedAt}</span>}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exporting || saving}
            onClick={() => void onExportPdf()}
          >
            {exporting ? "Exporting…" : "Export PDF"}
          </button>
          <button
            type="submit"
            form="rfi-form"
            className="btn btn-primary"
            disabled={saving || exporting}
          >
            {saving ? "Saving…" : "Save RFI"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <form id="rfi-form" className="stack" onSubmit={onSave}>
        <section className="card stack">
          <h2>Header</h2>
          <div className="grid-3">
            <label>
              RFI #
              <input value={rfiNumber} onChange={(e) => setRfiNumber(e.target.value)} />
            </label>
            <label>
              Date
              <input value={form.rfi_date} onChange={(e) => setField("rfi_date", e.target.value)} />
            </label>
            <label>
              Due date
              <input value={form.due_date} onChange={(e) => setField("due_date", e.target.value)} />
            </label>
          </div>
          <label>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </label>
          <div className="grid-2">
            <label>
              To
              <input value={form.to_name} onChange={(e) => setField("to_name", e.target.value)} />
            </label>
            <label>
              Attn
              <input value={form.attn_name} onChange={(e) => setField("attn_name", e.target.value)} />
            </label>
            <label>
              From
              <input value={form.from_name} onChange={(e) => setField("from_name", e.target.value)} />
            </label>
            <label>
              Spec ref
              <input value={form.spec_ref} onChange={(e) => setField("spec_ref", e.target.value)} />
            </label>
            <label>
              Drawing ref
              <input
                value={form.drawing_ref}
                onChange={(e) => setField("drawing_ref", e.target.value)}
              />
            </label>
            <label>
              Detail #
              <input value={form.detail_no} onChange={(e) => setField("detail_no", e.target.value)} />
            </label>
          </div>
        </section>

        <section className="card stack">
          <h2>Question</h2>
          <label>
            Request / question
            <textarea
              rows={8}
              value={form.question}
              onChange={(e) => setField("question", e.target.value)}
              placeholder="Describe the RFI question…"
            />
          </label>
        </section>

        <section className="card stack">
          <h2>Reason for request</h2>
          <div className="check-grid">
            <label className="check">
              <input
                type="checkbox"
                checked={form.reason_insufficient}
                onChange={(e) => setField("reason_insufficient", e.target.checked)}
              />
              Insufficient information
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.reason_conflict}
                onChange={(e) => setField("reason_conflict", e.target.checked)}
              />
              Conflict in documents
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.reason_alternate}
                onChange={(e) => setField("reason_alternate", e.target.checked)}
              />
              Alternate proposed
            </label>
          </div>
        </section>

        <section className="card stack">
          <h2>Action requested</h2>
          <div className="check-grid">
            <label className="check">
              <input
                type="checkbox"
                checked={form.action_clarification}
                onChange={(e) => setField("action_clarification", e.target.checked)}
              />
              Clarification
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.action_direction}
                onChange={(e) => setField("action_direction", e.target.checked)}
              />
              Direction
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.action_approval}
                onChange={(e) => setField("action_approval", e.target.checked)}
              />
              Approval
            </label>
          </div>
        </section>

        <section className="card stack">
          <h2>Cost / schedule</h2>
          <div className="grid-2">
            <label>
              Cost change
              <input
                value={form.cost_change}
                onChange={(e) => setField("cost_change", e.target.value)}
              />
            </label>
            <label>
              Schedule change
              <input
                value={form.sched_change}
                onChange={(e) => setField("sched_change", e.target.value)}
              />
            </label>
          </div>
        </section>
      </form>
    </div>
  );
}
