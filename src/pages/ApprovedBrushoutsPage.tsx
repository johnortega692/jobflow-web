import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { SubmittalsHubTabs } from "../components/submittals/SubmittalsHubTabs";
import { ImportApprovedBrushoutsModal } from "../components/paint/ImportApprovedBrushoutsModal";
import { useAuth } from "../contexts/AuthContext";
import {
  buildBrushoutImportSources,
  listProjectBrushouts,
  mergePaintItemsIntoBrushoutRows,
  saveProjectBrushouts,
  type ApprovedBrushoutDraft,
  type ApprovedBrushoutRow,
} from "../lib/approvedBrushouts";
import { applyApprovedPaintVendor } from "../lib/fieldTrackerProject";
import { PAINT_VENDOR_OPTIONS } from "../lib/googleSheetsConfig";
import { normalizePaintVendor } from "../lib/paintTrackerSync";
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

function lineSignature(rows: ApprovedBrushoutDraft[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id ?? "",
      label: row.label,
      floor: row.floor,
      manufacturer: row.manufacturer,
      color: row.color,
      product: row.product,
      sheen: row.sheen,
      display_line: row.display_line,
      approved: row.approved,
      sort_order: row.sort_order,
    })),
  );
}

function latestSavedAt(rows: ApprovedBrushoutRow[]): string | null {
  const times = rows
    .map((row) => (row as ApprovedBrushoutRow & { updated_at?: string }).updated_at)
    .filter((value): value is string => Boolean(value));
  if (!times.length) return null;
  return times.sort().at(-1) ?? null;
}

function formatSavedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const [savedApprovedCount, setSavedApprovedCount] = useState(0);
  const [savedSignature, setSavedSignature] = useState(() => lineSignature([]));
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const approveHeaderRef = useRef<HTMLInputElement>(null);

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
      const data = await listProjectBrushouts(projectId);
      const nextRows: ApprovedBrushoutDraft[] = data.map((r) => ({
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
      }));
      setRows(nextRows);
      setSavedSignature(lineSignature(nextRows));
      setLastSavedAt(latestSavedAt(data));
      setPaintVendor(
        normalizePaintVendor(data[0]?.paint_vendor ?? paintSubmittal.paint_vendor ?? ""),
      );
      setSavedApprovedCount(data.filter((r) => r.approved).length);
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

  async function onVendorChange(value: string) {
    const vendor = normalizePaintVendor(value);
    setPaintVendor(vendor);
    setRows((prev) => prev.map((row) => ({ ...row, paint_vendor: vendor })));
    setError(null);
    const err = await applyApprovedPaintVendor(projectId, vendor);
    if (err) {
      setError(err);
      return;
    }
    setStatus(`Paint vendor set to ${vendor}. Material Tracker and the paint submittal now use it.`);
  }

  function onImportSelected(selectedItems: PaintItem[]) {
    const vendor = normalizePaintVendor(paintVendor.trim() || paintSubmittal.paint_vendor?.trim() || "");
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
      const vendorErr = await applyApprovedPaintVendor(projectId, paintVendor.trim() || "PPG");
      if (vendorErr) throw new Error(vendorErr);
      setStatus(`Saved. ${withVendor.length} approved line(s) available to Field Tools.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const dirty = lineSignature(rows) !== savedSignature;
  const allApproved = rows.length > 0 && approvedCount === rows.length;
  const someApproved = approvedCount > 0 && !allApproved;
  const savedTime = lastSavedAt ? formatSavedTime(lastSavedAt) : "";

  useEffect(() => {
    if (approveHeaderRef.current) approveHeaderRef.current.indeterminate = someApproved;
  }, [someApproved, rows.length]);

  return (
    <div className="submittals-hub stack">
      <SubmittalsHubTabs badgeCount={loading ? undefined : savedApprovedCount} />
      <div className="brushout-page-heading">
        <div className="brushout-page-title-row">
          <h2 className="page-title">Approved brush-outs</h2>
          {!loading ? (
            <p className={`brushout-save-pill${dirty ? " is-dirty" : " is-saved"}`}>
              <span className="brushout-save-pill-mark" aria-hidden="true">
                {dirty ? (
                  <span className="brushout-save-pill-dot" />
                ) : (
                  <svg viewBox="0 0 16 16" width="13" height="13">
                    <path
                      d="M3.5 8.4 6.4 11.3 12.5 4.7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {dirty
                ? `Unsaved changes · ${approvedCount} of ${rows.length} approved · Field Tools still shows ${savedApprovedCount}`
                : `Saved · ${approvedCount} of ${rows.length} approved · synced to Field Tools${savedTime ? ` · ${savedTime}` : ""}`}
            </p>
          ) : null}
        </div>
        <p className="muted small">
          Job {project.job_number}
          {project.job_name ? ` — ${project.job_name}` : ""} · Checked lines go to Field Tools.
        </p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && !error && <div className="banner banner-ok">{status}</div>}

      <section className="card stack">
        <div className="row-between wrap gap">
          <label className="stack gap-xs" style={{ minWidth: 220 }}>
            <span className="label">Paint vendor · job-wide, also sets Material Tracker</span>
            <select
              className="input"
              value={normalizePaintVendor(paintVendor)}
              disabled={busy || loading}
              onChange={(e) => void onVendorChange(e.target.value)}
            >
              {PAINT_VENDOR_OPTIONS.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
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
            <button
              type="button"
              className="btn ghost"
              onClick={() => setRows((prev) => [...prev, emptyRow(prev.length)])}
              disabled={busy}
            >
              + Add line
            </button>
            <button
              type="button"
              className={`btn${dirty ? " btn-primary" : " btn-secondary"}`}
              onClick={() => void onSave()}
              disabled={busy || loading}
            >
              {busy ? "Saving…" : "Save approved"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted small">
            No brush-out lines yet. Use Import to pick one or more colors from the paint submittal, or add a line
            manually.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table brushout-lines-table">
              <thead>
                <tr>
                  <th className="brushout-col-approved">
                    <input
                      ref={approveHeaderRef}
                      type="checkbox"
                      checked={allApproved}
                      disabled={!rows.length || busy}
                      aria-label="Approve all lines"
                      onChange={() => approveAll(!allApproved)}
                    />
                  </th>
                  <th className="brushout-col-label">Label</th>
                  <th className="brushout-col-location">Location</th>
                  <th className="brushout-col-color">Color</th>
                  <th className="brushout-col-product">Product</th>
                  <th className="brushout-col-sheen">Sheen</th>
                  <th className="brushout-col-field">Field display</th>
                  <th className="brushout-col-remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? `new-${index}`}>
                    <td className="brushout-col-approved">
                      <input
                        type="checkbox"
                        checked={row.approved}
                        onChange={(e) => updateRow(index, { approved: e.target.checked })}
                        aria-label={`Approved ${row.label || index + 1}`}
                      />
                    </td>
                    <td className="brushout-col-label">
                      <input
                        className="input"
                        value={row.label}
                        title={row.label || undefined}
                        onChange={(e) => updateRow(index, { label: e.target.value })}
                      />
                    </td>
                    <td className="brushout-col-location">
                      <input
                        className="input"
                        value={row.floor}
                        placeholder="e.g. Ext walls, trim"
                        onChange={(e) => updateRow(index, { floor: e.target.value })}
                      />
                    </td>
                    <td className="brushout-col-color">
                      <input
                        className="input"
                        value={row.color}
                        title={row.color || undefined}
                        onChange={(e) => updateRow(index, { color: e.target.value })}
                      />
                    </td>
                    <td className="brushout-col-product">
                      <input
                        className="input"
                        value={row.product}
                        onChange={(e) => updateRow(index, { product: e.target.value })}
                      />
                    </td>
                    <td className="brushout-col-sheen">
                      <input
                        className="input"
                        value={row.sheen}
                        title={row.sheen || undefined}
                        onChange={(e) => updateRow(index, { sheen: e.target.value })}
                      />
                    </td>
                    <td className="brushout-col-field">
                      <span className="brushout-field-chip" title={row.display_line || undefined}>
                        {row.display_line || "—"}
                      </span>
                    </td>
                    <td className="brushout-col-remove">
                      <button type="button" className="btn ghost btn-sm" onClick={() => removeRow(index)}>
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
          onClose={() => setImportOpen(false)}
          onConfirm={onImportSelected}
        />
      )}
    </div>
  );
}
