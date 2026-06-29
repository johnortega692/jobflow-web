import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ImportApprovedBrushoutsModal } from "../components/paint/ImportApprovedBrushoutsModal";
import { useAuth } from "../contexts/AuthContext";
import {
  buildBrushoutImportSources,
  listProjectBrushouts,
  mergePaintItemsIntoBrushoutRows,
  saveProjectBrushouts,
  type ApprovedBrushoutDraft,
} from "../lib/approvedBrushouts";
import { commitProjectUpdate } from "../lib/projectActivity";
import { parseProjectDataBlob } from "../lib/jobInfo";
import { parseStartupChecklist, type StartupChecklistState } from "../lib/projectStartupChecklist";
import { supabase } from "../lib/supabase";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import { normalizePaintSubmittal, type PaintItem } from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

function emptyRow(sortOrder: number): ApprovedBrushoutDraft {
  return {
    paint_vendor: "",
    label: "",
    floor: "",
    manufacturer: "",
    color: "",
    product: "",
    sheen: "",
    display_line: "",
    approved: false,
    sort_order: sortOrder,
  };
}

export function ApprovedBrushoutsPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { user } = useAuth();
  const { tradeData } = useProjectTradeData(projectId);
  const [rows, setRows] = useState<ApprovedBrushoutDraft[]>([]);
  const [paintVendor, setPaintVendor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [checklistMarked, setChecklistMarked] = useState(false);
  const [savedApprovedCount, setSavedApprovedCount] = useState(0);

  const approverName = user?.email?.split("@")[0] ?? "PM";
  const paintSubmittal = useMemo(
    () => normalizePaintSubmittal(tradeData.paint_submittal),
    [tradeData.paint_submittal],
  );
  const importSources = useMemo(
    () => buildBrushoutImportSources(paintSubmittal, tradeData.paint_submittal_history),
    [paintSubmittal, tradeData.paint_submittal_history],
  );
  const canImport = importSources.some((source) => source.items.length > 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: brushoutData }, { data: projectData }] = await Promise.all([
        listProjectBrushouts(projectId).then((rows) => ({ data: rows })),
        supabase.from("projects").select("data").eq("id", projectId).single(),
      ]);

      const data = brushoutData;
      if (projectData?.data) {
        const blob = parseProjectDataBlob(projectData.data);
        const checklist = parseStartupChecklist(blob.startup_checklist);
        setChecklistMarked(checklist.brushouts_ordered);
      }

      if (data.length) {
        setRows(
          data.map((r) => ({
            id: r.id,
            paint_vendor: r.paint_vendor,
            label: r.label,
            floor: r.floor,
            manufacturer: r.manufacturer,
            color: r.color,
            product: r.product,
            sheen: r.sheen,
            display_line: r.display_line,
            approved: r.approved,
            sort_order: r.sort_order,
          })),
        );
        setPaintVendor(data[0]?.paint_vendor ?? "");
        setSavedApprovedCount(data.filter((r) => r.approved).length);
      } else {
        setPaintVendor(paintSubmittal.paint_vendor ?? "");
        setRows([]);
        setSavedApprovedCount(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId, paintSubmittal.paint_vendor]);

  useEffect(() => {
    void load();
  }, [load]);

  const approvedCount = useMemo(() => rows.filter((r) => r.approved).length, [rows]);

  function onImportSelected(selectedItems: PaintItem[]) {
    const vendor = paintVendor.trim() || paintSubmittal.paint_vendor?.trim() || "";
    if (!selectedItems.length) {
      setError("Select at least one color to import.");
      return;
    }
    setPaintVendor(vendor);
    setRows((prev) => mergePaintItemsIntoBrushoutRows(prev, selectedItems, vendor));
    setImportOpen(false);
    setStatus(
      `Added ${selectedItems.length} line(s). Check Approved on the ones ready for field use, then save.`,
    );
    setError(null);
  }

  function updateRow(index: number, patch: Partial<ApprovedBrushoutDraft>) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (patch.label !== undefined || patch.floor !== undefined || patch.color !== undefined) {
          const parts = [next.label, next.floor.replace(/Floor/gi, "FL"), next.color].filter(Boolean);
          next.display_line = parts.join(" - ");
        }
        return next;
      }),
    );
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function approveAll(on: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, approved: on })));
  }

  async function onSave() {
    const approvedRows = rows.filter((r) => r.approved);
    if (!approvedRows.length) {
      setError("Check Approved on at least one line before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const withVendor = approvedRows.map((r) => ({
        ...r,
        paint_vendor: paintVendor.trim() || r.paint_vendor,
      }));
      await saveProjectBrushouts(projectId, project.job_number, withVendor, approverName);
      setStatus(`Saved. ${withVendor.length} approved line(s) available to Field Tools.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function markStartupChecklistComplete() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from("projects")
        .select("data")
        .eq("id", projectId)
        .single();
      if (fetchErr) throw new Error(fetchErr.message);

      const blob = parseProjectDataBlob(data?.data);
      const checklist = parseStartupChecklist(blob.startup_checklist);
      const next: StartupChecklistState = { ...checklist, brushouts_ordered: true };
      const err = await commitProjectUpdate({
        projectId,
        mergeData: { startup_checklist: next },
        activity: {
          action: "startup_checklist_updated",
          summary: "Startup checklist — brush-outs marked complete",
        },
      });
      if (err) throw new Error(err);
      setChecklistMarked(true);
      setStatus((prev) =>
        prev
          ? `${prev} Brush-outs step marked complete on startup checklist.`
          : "Brush-outs step marked complete on startup checklist.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update startup checklist");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row-between wrap gap">
        <div>
          <h2 className="page-title">Approved brush-outs</h2>
          <p className="muted small">
            Job {project.job_number}
            {project.job_name ? ` — ${project.job_name}` : ""}. Import from the paint tab or saved submittal history,
            check <strong>Approved</strong> on the ones ready for field use, then save.
          </p>
        </div>
        <Link className="btn ghost" to={`/projects/${projectId}/paint`}>
          ← Paint submittal
        </Link>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && !error && <div className="banner banner-ok">{status}</div>}

      {savedApprovedCount > 0 && (
        <section className="card stack gap-xs">
          <p className="muted small" style={{ margin: 0 }}>
            Startup checklist — <strong>Brush outs</strong>:{" "}
            {checklistMarked ? (
              <>marked complete ({savedApprovedCount} color{savedApprovedCount === 1 ? "" : "s"} in Field Tools)</>
            ) : (
              <>not checked yet ({savedApprovedCount} saved for Field Tools)</>
            )}
          </p>
          {!checklistMarked && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Mark complete when this wave is ready for field. You can approve more colors later (e.g. a revised
                PT-03) without unchecking the step.
              </p>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || loading}
                  onClick={() => void markStartupChecklistComplete()}
                >
                  Mark startup checklist complete
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card stack">
        <div className="row-between wrap gap">
          <label className="stack gap-xs" style={{ minWidth: 220 }}>
            <span className="label">Brush-out vendor</span>
            <input
              className="input"
              value={paintVendor}
              onChange={(e) => setPaintVendor(e.target.value)}
              placeholder="e.g. PPG Paints"
            />
          </label>
          <div className="row-gap wrap">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setImportOpen(true)}
              disabled={busy || loading || !canImport}
            >
              Import from paint submittal
            </button>
            <button type="button" className="btn ghost" onClick={() => setRows((r) => [...r, emptyRow(r.length)])}>
              + Add line
            </button>
            <button type="button" className="btn ghost" onClick={() => approveAll(true)} disabled={!rows.length}>
              Approve all
            </button>
            <button type="button" className="btn ghost" onClick={() => approveAll(false)} disabled={!rows.length}>
              Clear approvals
            </button>
            <button type="button" className="btn primary" onClick={() => void onSave()} disabled={busy || loading}>
              {busy ? "Saving…" : "Save approved"}
            </button>
          </div>
        </div>

        <p className="muted small">
          {approvedCount} of {rows.length} line{rows.length === 1 ? "" : "s"} marked approved (not saved until you
          click Save approved).
        </p>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : !rows.length ? (
          <p className="muted">
            No brush-out lines yet. Use Import to pick one or more colors from the paint submittal, or add a line
            manually.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Approved</th>
                  <th>Label</th>
                  <th>Floor</th>
                  <th>Color</th>
                  <th>Product</th>
                  <th>Sheen</th>
                  <th>Field display</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? `new-${index}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.approved}
                        onChange={(e) => updateRow(index, { approved: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        value={row.label}
                        onChange={(e) => updateRow(index, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        value={row.floor}
                        onChange={(e) => updateRow(index, { floor: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        value={row.color}
                        onChange={(e) => updateRow(index, { color: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        value={row.product}
                        onChange={(e) => updateRow(index, { product: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        value={row.sheen}
                        onChange={(e) => updateRow(index, { sheen: e.target.value })}
                      />
                    </td>
                    <td className="muted small">{row.display_line || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove line"
                        onClick={() => removeRow(index)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {importOpen && (
        <ImportApprovedBrushoutsModal
          sources={importSources}
          existingRows={rows}
          busy={busy}
          onConfirm={onImportSelected}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
