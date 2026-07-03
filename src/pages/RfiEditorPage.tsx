import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DateInput } from "../components/DateInput";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { RfiAiAssistModal } from "../components/rfi/RfiAiAssistModal";
import { RfiAttachmentsSection } from "../components/rfi/RfiAttachmentsSection";
import { RfiStatusBadge } from "../components/rfi/RfiStatusBadge";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { removeRfiAttachments } from "../lib/rfiFileStorage";
import {
  RFI_STATUS_CLOSED,
  RFI_STATUS_OPEN,
  normalizeRfiStatus,
  type RfiWorkflowStatus,
} from "../lib/rfiStatus";
import { supabase } from "../lib/supabase";
import { printRfi } from "../lib/rfiPrint";
import { rfiFilename } from "../lib/pdfFilenames";
import { applyRfiProfileDefaults } from "../lib/userProfile";
import {
  RFI_ACTION_LABELS,
  RFI_EFFECT_LABELS,
  RFI_REASON_LABELS,
} from "../lib/rfiFormLabels";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  applyJobInfoToRfi,
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  projectPrintInfoForContract,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import {
  defaultRfiFormData,
  normalizeProject,
  normalizeRfiFormData,
  type Json,
  type ProjectForm,
  type Rfi,
  type RfiAttachedFile,
  type RfiFormData,
} from "../types/database";

function parseRfiData(raw: unknown): RfiFormData {
  return normalizeRfiFormData(raw);
}

export function RfiEditorPage() {
  const { branding, profile } = useLetterhead();
  const navigate = useNavigate();
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const [project, setProject] = useState<ProjectForm | null>(null);
  const [rfiNumber, setRfiNumber] = useState("001");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<RfiWorkflowStatus>(RFI_STATUS_OPEN);
  const [form, setForm] = useState<RfiFormData>(defaultRfiFormData());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [aiAssistOpen, setAiAssistOpen] = useState(false);

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
      setProject(normalizeProject(projRes.data));
      const rfi = rfiRes.data as Rfi;
      setRfiNumber(rfi.rfi_number ?? "001");
      setSubject(rfi.subject ?? "");
      setStatus(normalizeRfiStatus(rfi.status));
      const proj = normalizeProject(projRes.data);
      const withProfile = applyRfiProfileDefaults(parseRfiData(rfi.data), profile);
      const withJobInfo = applyJobInfoToRfi(withProfile, proj.contractor, proj.jobInfo);
      setForm({ ...withJobInfo, contract: coerceTransmittalContract(proj, withJobInfo.contract) });
    }
    void load();
  }, [projectId, rfiId, profile]);

  function setField<K extends keyof RfiFormData>(key: K, value: RfiFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function persistFormData(next: RfiFormData) {
    if (!rfiId) return;
    const { error: err } = await supabase
      .from("rfis")
      .update({
        data: next as unknown as Json,
      })
      .eq("id", rfiId);
    if (err) throw new Error(err.message);
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_saved",
        summary: `RFI #${rfiNumber} updated (attachments)`,
      });
    }
  }

  async function persistAttachedFiles(files: RfiAttachedFile[]) {
    const next = { ...form, attached_files: files };
    setForm(next);
    await persistFormData(next);
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
        data: form as unknown as Json,
        status,
      })
      .eq("id", rfiId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_saved",
        summary: `RFI #${rfiNumber}${subject.trim() ? ` — ${subject.trim()}` : ""} saved`,
      });
    }
  }

  async function markStatus(next: RfiWorkflowStatus) {
    if (!rfiId || status === next) return;
    setStatusBusy(true);
    setError(null);
    const { error: err } = await supabase.from("rfis").update({ status: next }).eq("id", rfiId);
    setStatusBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStatus(next);
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_status_updated",
        summary: `RFI #${rfiNumber} marked ${next}`,
      });
    }
  }

  function onPrintPdf() {
    if (!project) return;
    if (!subject.trim()) {
      setError("Enter a subject before printing.");
      return;
    }
    setPrinting(true);
    setError(null);
    try {
      const printProject = projectPrintInfoForContract(project, form.contract);
      printRfi({
        project: {
          job_number: printProject.job_number,
          job_name: printProject.job_name,
          job_address: printProject.job_address,
          job_address2: printProject.job_address_line2,
          contractor: project.contractor ?? "",
          architect: project.architect ?? "",
          owner: project.owner ?? "",
        },
        rfi_number: rfiNumber,
        subject,
        form,
        branding,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  async function onDelete() {
    if (!rfiId || !projectId) return;
    if (
      !window.confirm(
        `Delete RFI #${rfiNumber}${subject ? ` — "${subject}"` : ""}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await removeRfiAttachments(form.attached_files.map((f) => f.storage_path));
    } catch {
      /* storage cleanup best-effort */
    }
    const { error: err } = await supabase.from("rfis").delete().eq("id", rfiId);
    setDeleting(false);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_deleted",
      summary: `RFI #${rfiNumber}${subject.trim() ? ` — ${subject.trim()}` : ""} deleted`,
    });
    navigate(`/projects/${projectId}/rfis`);
  }

  const contractJob = useMemo(
    () => (project ? transmittalPrintInfo(project, form.contract) : { job_number: "", job_name: "" }),
    [project, form.contract],
  );

  const outputFilename = project
    ? rfiFilename(contractJob.job_name, contractJob.job_number, rfiNumber)
    : "";

  if (loading) return <p className="muted">Loading RFI…</p>;
  if (!project) return <p className="banner banner-error">{error ?? "Not found"}</p>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/projects">Projects</Link> /{" "}
            <Link to={`/projects/${projectId}/rfis`}>{project.job_number}</Link> / RFI {rfiNumber}
          </p>
          <h1>RFI {rfiNumber}</h1>
          <p className="muted row-gap wrap" style={{ alignItems: "center" }}>
            <span>
              {contractJob.job_number}
              {contractJob.job_name ? ` · ${contractJob.job_name}` : ""}
            </span>
            <RfiStatusBadge status={status} />
          </p>
        </div>
        <div className="row-gap wrap">
          {project && hasTransmittalContractSwitch(project) && (
            <TradeContractTabs
              project={project}
              value={form.contract}
              onChange={(contract) => setField("contract", contract)}
            />
          )}
          {status === RFI_STATUS_OPEN ? (
            <button
              type="button"
              className="btn btn-success-soft"
              disabled={statusBusy || saving || deleting}
              onClick={() => void markStatus(RFI_STATUS_CLOSED)}
            >
              Mark closed
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={statusBusy || saving || deleting}
              onClick={() => void markStatus(RFI_STATUS_OPEN)}
            >
              Mark open
            </button>
          )}
          {savedAt && <span className="muted small">Saved {savedAt}</span>}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={printing || saving}
            onClick={onPrintPdf}
          >
            {printing ? "Opening…" : "Print / Save PDF"}
          </button>
          <button
            type="submit"
            form="rfi-form"
            className="btn btn-primary"
            disabled={saving || printing || deleting}
          >
            {saving ? "Saving…" : "Save RFI"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-danger-soft"
            disabled={deleting || saving || printing}
            onClick={() => void onDelete()}
          >
            {deleting ? "Deleting…" : "Delete RFI"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{outputFilename}</code>
      </p>

      <form id="rfi-form" className="stack" onSubmit={onSave}>
        <section className="card rfi-pdf-include-bar row-gap wrap">
          <span className="rfi-pdf-include-label muted small">PDF include:</span>
          <label className="check">
            <input
              type="checkbox"
              checked={form.pdf_show_solution}
              onChange={(e) => setField("pdf_show_solution", e.target.checked)}
            />
            Proposed solution
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.pdf_show_response}
              onChange={(e) => setField("pdf_show_response", e.target.checked)}
            />
            Official response
          </label>
        </section>

        <section className="card stack">
          <h2>Header</h2>
          <div className="grid-3">
            <label>
              RFI #
              <input value={rfiNumber} onChange={(e) => setRfiNumber(e.target.value)} />
            </label>
            <label>
              Date
              <DateInput value={form.rfi_date} onChange={(v) => setField("rfi_date", v)} />
            </label>
            <label>
              Due date
              <DateInput value={form.due_date} onChange={(v) => setField("due_date", v)} />
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
              {!form.to_name.trim() && project?.contractor.trim() && (
                <span className="muted small">Defaults from Job setup → GC (contractor)</span>
              )}
            </label>
            <label>
              Attn
              <input value={form.attn_name} onChange={(e) => setField("attn_name", e.target.value)} />
              {!form.attn_name.trim() &&
                (project?.jobInfo.gc_pm.trim() || project?.jobInfo.gc_superintendent.trim()) && (
                  <span className="muted small">Defaults from Job setup → GC PM / super</span>
                )}
            </label>
            <label>
              From
              <input value={form.from_name} onChange={(e) => setField("from_name", e.target.value)} />
              {!form.from_name.trim() && profile.name.trim() && (
                <span className="muted small">Defaults from Settings → Your profile</span>
              )}
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
          <div className="row-between wrap">
            <h2>Question</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!form.question.trim()) {
                  setError("Fill in the Request field first, then open AI Assist.");
                  return;
                }
                setError(null);
                setAiAssistOpen(true);
              }}
            >
              ✦ AI Assist
            </button>
          </div>
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

        <section className="card rfi-checkbox-row">
          <div className="rfi-checkbox-columns">
            <div className="rfi-checkbox-col">
              <h3 className="rfi-checkbox-col-title">Reason for request</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.reason_insufficient}
                  onChange={(e) => setField("reason_insufficient", e.target.checked)}
                />
                {RFI_REASON_LABELS.reason_insufficient}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.reason_conflict}
                  onChange={(e) => setField("reason_conflict", e.target.checked)}
                />
                {RFI_REASON_LABELS.reason_conflict}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.reason_alternate}
                  onChange={(e) => setField("reason_alternate", e.target.checked)}
                />
                {RFI_REASON_LABELS.reason_alternate}
              </label>
            </div>

            <div className="rfi-checkbox-col">
              <h3 className="rfi-checkbox-col-title">Action requested</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.action_clarification}
                  onChange={(e) => setField("action_clarification", e.target.checked)}
                />
                {RFI_ACTION_LABELS.action_clarification}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.action_direction}
                  onChange={(e) => setField("action_direction", e.target.checked)}
                />
                {RFI_ACTION_LABELS.action_direction}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.action_approval}
                  onChange={(e) => setField("action_approval", e.target.checked)}
                />
                {RFI_ACTION_LABELS.action_approval}
              </label>
            </div>

            <div className="rfi-checkbox-col">
              <h3 className="rfi-checkbox-col-title">Probable effect</h3>
              <div className="rfi-effect-checks">
                {RFI_EFFECT_LABELS.map(({ key, label }) => (
                  <label key={key} className="check">
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(e) => setField(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Recommendation</h2>
          <label>
            Contractor&apos;s recommended resolution
            <textarea
              rows={4}
              value={form.solution_text}
              onChange={(e) => setField("solution_text", e.target.value)}
            />
          </label>
        </section>

        <section className="card stack">
          <h2>Internal notes</h2>
          <p className="muted small">For internal use only — not printed on the RFI PDF.</p>
          <label>
            Notes
            <textarea
              rows={4}
              value={form.impact_notes}
              onChange={(e) => setField("impact_notes", e.target.value)}
            />
          </label>
        </section>

        {projectId && rfiId && (
          <RfiAttachmentsSection
            projectId={projectId}
            rfiId={rfiId}
            form={form}
            setField={setField}
            onFilesPersisted={persistAttachedFiles}
            onError={(message) => setError(message || null)}
          />
        )}

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

      {aiAssistOpen && (
        <RfiAiAssistModal
          projectName={project.job_name}
          subject={subject}
          question={form.question}
          solutionText={form.solution_text}
          onApply={(q, sol) => {
            setField("question", q);
            if (sol) setField("solution_text", sol);
            setAiAssistOpen(false);
          }}
          onClose={() => setAiAssistOpen(false)}
        />
      )}
    </div>
  );
}
