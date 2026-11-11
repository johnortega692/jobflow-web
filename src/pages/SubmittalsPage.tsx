import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ContractListFilter, type ContractListFilterValue } from "../components/jobinfo/ContractListFilter";
import { SubmittalLogRowEditor } from "../components/submittals/SubmittalLogRowEditor";
import { exportSubmittalLogExcel } from "../lib/submittalLogExport";
import {
  buildRevisionRow,
  filterSubmittalLogByContract,
  formatLogRevision,
  suggestNextLineNumber,
} from "../lib/submittalLogHelpers";
import {
  deleteSubmittalLogRows,
  insertSubmittalLogRow,
  loadSubmittalLogRows,
  markRowsSubmitted,
  updateSubmittalLogRow,
} from "../lib/submittalLogService";
import {
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
  TRANSMITTAL_CONTRACT_LABELS,
} from "../lib/jobInfo";
import type { ProjectForm } from "../types/database";
import { emptySubmittalLogRow, type SubmittalLogRow } from "../types/submittalLog";

type Ctx = { project: ProjectForm; projectId: string };

type EditorState =
  | { mode: "add"; row: SubmittalLogRow }
  | { mode: "edit"; row: SubmittalLogRow }
  | { mode: "revision"; row: SubmittalLogRow }
  | null;

export function SubmittalsPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const [rows, setRows] = useState<SubmittalLogRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [viewContract, setViewContract] = useState<ContractListFilterValue>("all");

  const showContractSwitch = hasTransmittalContractSwitch(project);

  const visibleRows = useMemo(
    () => filterSubmittalLogByContract(rows, viewContract),
    [rows, viewContract],
  );

  useEffect(() => {
    setViewContract("all");
    setSelectedId(null);
  }, [projectId]);

  useEffect(() => {
    setSelectedId(null);
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

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

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

  async function onDeleteRow(row: SubmittalLogRow) {
    if (!row.id) return;
    await deleteSubmittalLogRows(projectId, [row.id]);
    setSelectedId((current) => (current === row.id ? null : current));
    setEditor(null);
    setStatus(`Deleted row #${row.line_number}.`);
    await reload();
  }

  async function onMarkSubmitted(row: SubmittalLogRow) {
    await markRowsSubmitted(projectId, [row], row.transmittal_number);
    setEditor(null);
    setStatus(`Marked row #${row.line_number} submitted.`);
    await reload();
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
          disabled={!selectedRow}
          onClick={() => {
            if (selectedRow) setEditor({ mode: "edit", row: selectedRow });
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selectedRow}
          onClick={() => {
            if (selectedRow) setEditor({ mode: "revision", row: buildRevisionRow(selectedRow) });
          }}
        >
          Create Revision
        </button>
        <span className="submittal-log-toolbar-spacer" aria-hidden />
        <button type="button" className="btn btn-success" onClick={onExport}>
          Export to Excel
        </button>
      </div>
      <p className="muted small">
        Product data and SDS are built on the Package tab. Downloading that PDF adds the log row and suggests it on the Transmittal.
      </p>

      <ContractListFilter project={project} value={viewContract} onChange={setViewContract} />

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
                <th>#</th>
                <th>SECTION</th>
                <th>SCOPE</th>
                <th>SUBMITTAL</th>
                <th>Rev</th>
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
                  <tr
                    key={row.id}
                    className={selectedId === row.id ? "selected submittal-log-row" : "submittal-log-row"}
                    title="Click to select. Double-click to edit."
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => {
                      setSelectedId(row.id);
                      setEditor({ mode: "edit", row });
                    }}
                  >
                    <td>{row.line_number}</td>
                    <td>{row.section}</td>
                    <td>{row.scope}</td>
                    <td>{row.submittal_type}</td>
                    <td className="submittal-log-rev">{formatLogRevision(row.revision_number)}</td>
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
          onDelete={(row) => void onDeleteRow(row)}
          onMarkSubmitted={(row) => void onMarkSubmitted(row)}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.mode === "revision" && (
        <SubmittalLogRowEditor
          title="Revise this row"
          row={editor.row}
          existingRows={rows.filter((r) => r.id !== editor.row.id)}
          onSave={(row) => void onEditSave(row)}
          onDelete={(row) => void onDeleteRow(row)}
          onMarkSubmitted={(row) => void onMarkSubmitted(row)}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
