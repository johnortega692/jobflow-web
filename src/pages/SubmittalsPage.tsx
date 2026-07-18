import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ContractListFilter, type ContractListFilterValue } from "../components/jobinfo/ContractListFilter";
import { SubmittalLogRowEditor } from "../components/submittals/SubmittalLogRowEditor";
import { exportSubmittalLogExcel } from "../lib/submittalLogExport";
import {
  buildRevisionRow,
  filterSubmittalLogByContract,
  rowEnclosureDescription,
  scopeToContract,
  suggestNextLineNumber,
} from "../lib/submittalLogHelpers";
import {
  deleteSubmittalLogRows,
  insertSubmittalLogRow,
  loadSubmittalLogRows,
  markRowsSubmitted,
  updateSubmittalLogRow,
} from "../lib/submittalLogService";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import {
  applyInferredContentFlags,
  inferContentKeysFromText,
  loadTransmittalContentAutoOn,
} from "../lib/transmittalCategories";
import {
  applyTransmittalContractIfDistinct,
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../lib/jobInfo";
import type { ProjectForm } from "../types/database";
import { defaultTransmittal, emptyEnclosure } from "../types/tradeDocuments";
import { emptySubmittalLogRow, type SubmittalLogRow } from "../types/submittalLog";

type Ctx = { project: ProjectForm; projectId: string };

type EditorState =
  | { mode: "add"; row: SubmittalLogRow }
  | { mode: "edit"; row: SubmittalLogRow }
  | { mode: "revision"; row: SubmittalLogRow }
  | null;

export function SubmittalsPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, save } = useProjectTradeData(projectId);
  const [rows, setRows] = useState<SubmittalLogRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [transPromptOpen, setTransPromptOpen] = useState(false);
  const [transNumber, setTransNumber] = useState("");
  const [viewContract, setViewContract] = useState<ContractListFilterValue>("all");

  const showContractSwitch = hasTransmittalContractSwitch(project);

  const visibleRows = useMemo(
    () => filterSubmittalLogByContract(rows, viewContract),
    [rows, viewContract],
  );

  useEffect(() => {
    setViewContract("all");
    setSelected(new Set());
  }, [projectId]);

  useEffect(() => {
    setSelected(new Set());
  }, [viewContract]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadSubmittalLogRows(projectId);
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load submittal log");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );

  function toggleSelect(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(visibleRows.map((r) => r.id)) : new Set());
  }

  async function onAddSave(row: SubmittalLogRow) {
    await insertSubmittalLogRow(projectId, row);
    setEditor(null);
    setStatus(`Added log row #${row.line_number}.`);
    await reload();
  }

  async function onEditSave(row: SubmittalLogRow) {
    await updateSubmittalLogRow(projectId, row);
    setEditor(null);
    setStatus(`Updated row #${row.line_number}.`);
    await reload();
  }

  async function onDelete() {
    if (!selectedRows.length) {
      setError("Select one or more rows to delete.");
      return;
    }
    if (!window.confirm(`Delete ${selectedRows.length} row(s) from the submittal log?`)) return;
    await deleteSubmittalLogRows(projectId, selectedRows.map((r) => r.id));
    setSelected(new Set());
    setStatus(`Deleted ${selectedRows.length} row(s).`);
    await reload();
  }

  async function confirmMarkSubmitted() {
    if (!selectedRows.length) {
      setError("Select one or more rows to mark submitted.");
      return;
    }
    await markRowsSubmitted(projectId, selectedRows, transNumber);
    setTransPromptOpen(false);
    setTransNumber("");
    setStatus(`Marked ${selectedRows.length} row(s) submitted.`);
    await reload();
  }

  async function onAddToTransmittal() {
    if (!selectedRows.length) {
      setError("Select one or more rows to add to transmittal.");
      return;
    }
    const transmittal = tradeData.transmittal ?? defaultTransmittal();
    const existing = transmittal.enclosures.filter((e) => e.description.trim());
    const additions = selectedRows.map((row) => ({
      ...emptyEnclosure(),
      description: rowEnclosureDescription(row),
      included: true,
      copies: "1",
      log_row_id: row.id,
    }));
    let nextTransmittal = {
      ...transmittal,
      enclosures: [...existing, ...additions],
    };
    const inferred: ReturnType<typeof inferContentKeysFromText> = [];
    for (const row of selectedRows) {
      inferred.push(...inferContentKeysFromText(`${row.submittal_type} ${row.notes ?? ""}`));
    }
    const autoOn = await loadTransmittalContentAutoOn();
    nextTransmittal = applyInferredContentFlags(nextTransmittal, inferred, autoOn);
    const inferredContracts = new Set(
      selectedRows
        .map((row) => scopeToContract(row.scope))
        .filter((c): c is TransmittalContract => c != null),
    );
    if (inferredContracts.size === 1) {
      const [contract] = [...inferredContracts];
      if (contract) {
        nextTransmittal = applyTransmittalContractIfDistinct(project, nextTransmittal, contract);
      }
    }
    const ok = await save({
      ...tradeData,
      transmittal: nextTransmittal,
    });
    if (ok) {
      setStatus(`Added ${selectedRows.length} enclosure line(s) to Transmittal tab.`);
      setError(null);
    }
  }

  function onExport() {
    const printContract = viewContract === "all" ? "paint" : viewContract;
    const printInfo = transmittalPrintInfo(project, printContract);
    if (!printInfo.job_number.trim() || !printInfo.job_name.trim()) {
      setError("Job number and job name are required for export.");
      return;
    }
    const exportRows = filterSubmittalLogByContract(rows, viewContract);
    if (!exportRows.length) {
      setError(
        viewContract === "all"
          ? "No rows to export."
          : `No ${TRANSMITTAL_CONTRACT_LABELS[viewContract]} submittal log rows to export.`,
      );
      return;
    }
    exportSubmittalLogExcel(exportRows, printInfo.job_number, printInfo.job_name, {
      includeContractColumn: showContractSwitch && viewContract === "all",
      exportLabel:
        viewContract === "all" ? "All contracts" : TRANSMITTAL_CONTRACT_LABELS[viewContract],
    });
    setStatus("Submittal log exported to Excel.");
    setError(null);
  }

  return (
    <section className="card stack submittal-log-page">
      <div className="submittal-log-toolbar row-gap wrap">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            setEditor({
              mode: "add",
              row: emptySubmittalLogRow(suggestNextLineNumber(rows.map((r) => r.line_number))),
            })
          }
        >
          Add Row
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={selectedRows.length !== 1}
          onClick={() => {
            const row = selectedRows[0];
            if (row) setEditor({ mode: "edit", row });
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selectedRows.length}
          onClick={() => void onDelete()}
        >
          Delete
        </button>
        <button
          type="button"
          className="btn btn-warning"
          disabled={!selectedRows.length}
          onClick={() => setTransPromptOpen(true)}
        >
          Mark Submitted
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={selectedRows.length !== 1}
          onClick={() => {
            const src = selectedRows[0];
            if (src) setEditor({ mode: "revision", row: buildRevisionRow(src, rows) });
          }}
        >
          Create Revision
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selectedRows.length}
          onClick={() => void onAddToTransmittal()}
        >
          Add to Transmittal
        </button>
        <span className="submittal-log-toolbar-spacer" aria-hidden />
        <button type="button" className="btn btn-success" onClick={onExport}>
          Export to Excel
        </button>
      </div>

      <ContractListFilter project={project} value={viewContract} onChange={setViewContract} />

      <p className="muted small">
        Log rows are added when you build PDFs (submittal packages, paint, wallcovering, FRP).
        Generate
        Transmittal stamps SUBMIT + Trans # on rows you include. Edit manually anytime.
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      {loading ? (
        <p className="muted">Loading submittal log…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No log rows yet. Build a PDF or click Add row.</p>
      ) : visibleRows.length === 0 ? (
        <p className="muted">
          No log rows for{" "}
          {viewContract === "all" ? "this job" : TRANSMITTAL_CONTRACT_LABELS[viewContract]}.
        </p>
      ) : (
        <div className="table-wrap submittal-log-table-wrap">
          <table className="data-table submittal-log-table">
            <thead>
              <tr>
                <th className="submittal-log-check">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={
                      visibleRows.length > 0 &&
                      visibleRows.every((row) => selected.has(row.id))
                    }
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th>#</th>
                <th>SPEC</th>
                <th>SCOPE</th>
                <th>SECTION</th>
                <th>SUBMITTAL</th>
                <th>SUBMIT</th>
                <th>RETURN</th>
                <th>RESULT</th>
                <th>Status</th>
                <th>Trans #</th>
                <th>Files</th>
                <th>NOTES</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                  <tr key={row.id} className={selected.has(row.id) ? "selected" : undefined}>
                    <td className="submittal-log-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(e) => toggleSelect(row.id, e.target.checked)}
                        aria-label={`Select row ${row.line_number}`}
                      />
                    </td>
                    <td>{row.line_number}</td>
                    <td>{row.spec}</td>
                    <td>{row.scope}</td>
                    <td>{row.section}</td>
                    <td>{row.submittal_type}</td>
                    <td>{row.submit_date}</td>
                    <td>{row.return_date}</td>
                    <td>{row.result}</td>
                    <td>{row.status}</td>
                    <td>{row.transmittal_number}</td>
                    <td className="submittal-log-files muted small" title={row.linked_files.join(", ")}>
                      {row.linked_files.length
                        ? row.linked_files.length === 1
                          ? row.linked_files[0]
                          : `${row.linked_files.length} files`
                        : "—"}
                    </td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small submittal-log-legend">
        RESULT: AAN = Approved as Noted · NET = No Exceptions Taken · R&R = Revise &amp; Resubmit ·
        MCN = Make Corrections Noted
      </p>

      {editor?.mode === "add" && (
        <SubmittalLogRowEditor
          title="Add submittal log row"
          row={editor.row}
          existingRows={rows}
          onSave={(row) => void onAddSave(row)}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.mode === "edit" && (
        <SubmittalLogRowEditor
          title="Edit submittal log row"
          row={editor.row}
          existingRows={rows.filter((r) => r.id !== editor.row.id)}
          onSave={(row) => void onEditSave(row)}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.mode === "revision" && (
        <SubmittalLogRowEditor
          title="New revision row"
          row={editor.row}
          existingRows={rows}
          onSave={(row) => void onAddSave(row)}
          onClose={() => setEditor(null)}
        />
      )}

      {transPromptOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setTransPromptOpen(false)}>
          <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
            <h3>Mark submitted</h3>
            <p className="muted small">
              Stamp today&apos;s date and Submitted status on {selectedRows.length} selected row(s).
            </p>
            <label>
              Transmittal # (optional)
              <input value={transNumber} onChange={(e) => setTransNumber(e.target.value)} />
            </label>
            <div className="row-gap wrap">
              <button type="button" className="btn btn-primary" onClick={() => void confirmMarkSubmitted()}>
                Mark submitted
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setTransPromptOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
