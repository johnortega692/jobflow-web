import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  downloadFilledTemplate,
  fillExcelTemplateBuffer,
  filledTemplateFilename,
} from "../lib/excelTemplateFill";
import {
  EXCEL_TEMPLATE_FILES,
  buildTemplateFieldPreview,
  matchTemplateConfig,
  templateDisplayName,
  type ExcelTemplateFile,
} from "../lib/excelPasteHelper";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls");
}

function pickExcelFromDataTransfer(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer?.files.length) return null;
  return [...dataTransfer.files].find(isExcelFile) ?? null;
}

export function ExcelPasteHelperPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { branding } = useLetterhead();
  const uploadRef = useRef<HTMLInputElement>(null);

  const [templateKey, setTemplateKey] = useState(EXCEL_TEMPLATE_FILES[0]?.file ?? "");
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploadedBytes, setUploadedBytes] = useState<ArrayBuffer | null>(null);
  const [filling, setFilling] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const extras = useMemo(
    () => ({ signaturePrintName: branding.signerName }),
    [branding.signerName],
  );

  const selectedConfig = useMemo(
    () => EXCEL_TEMPLATE_FILES.find((t) => t.file === templateKey) ?? EXCEL_TEMPLATE_FILES[0] ?? null,
    [templateKey],
  );

  const preview = useMemo(
    () => (selectedConfig ? buildTemplateFieldPreview(selectedConfig.mappings, project, extras) : []),
    [selectedConfig, project, extras],
  );

  const filledCount = preview.filter((f) => f.value.trim()).length;

  async function onUpload(file: File | null) {
    if (!file) return;
    if (!isExcelFile(file)) {
      setError("Choose an Excel file (.xlsx, .xlsm, or .xls).");
      return;
    }
    setError(null);
    setStatus(null);
    const bytes = await file.arrayBuffer();
    setUploadedBytes(bytes);
    setUploadedName(file.name);
    const matched = matchTemplateConfig(file.name);
    if (matched) {
      setTemplateKey(matched.file);
      setStatus(`Matched "${templateDisplayName(matched.file)}" — ready to fill.`);
    } else {
      setStatus("File uploaded — pick the template type below if auto-match failed.");
    }
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!filling) setDragOver(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!filling) e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = pickExcelFromDataTransfer(e.dataTransfer);
    if (!file) {
      setError("Drop an Excel file (.xlsx, .xlsm, or .xls).");
      return;
    }
    void onUpload(file);
  }

  async function onFillAndDownload() {
    if (!uploadedBytes || !uploadedName || !selectedConfig) {
      setError("Choose a template type and upload the .xlsx from your job folder first.");
      return;
    }
    setFilling(true);
    setError(null);
    try {
      const result = await fillExcelTemplateBuffer(
        uploadedBytes,
        selectedConfig.mappings,
        project,
        extras,
      );
      const filename = filledTemplateFilename(
        uploadedName,
        project,
        selectedConfig.rename_on_fill,
      );
      downloadFilledTemplate(result.bytes, filename);
      setStatus(
        `Downloaded ${filename} — ${result.filledCount} field${result.filledCount === 1 ? "" : "s"} written (merged cells included). Open in Excel.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fill template");
    } finally {
      setFilling(false);
    }
  }

  return (
    <div className="stack excel-paste-page">
      <div>
        <h2>Excel templates</h2>
        <p className="muted small">
          Same as desktop <strong>Fill Templates</strong>: upload your .xlsx, one click writes Job
          Info text into mapped cells (merged cells included) and <strong>keeps your template
          fonts and formatting</strong>, then download the filled file. Data from{" "}
          <Link to={`/projects/${projectId}`}>Job Info</Link> and{" "}
          <Link to="/settings">Settings</Link>.
        </p>
      </div>

      {(error || status) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? status}</div>
      )}

      <section className="card stack excel-fill-panel">
        <h3>Fill template</h3>
        <ol className="excel-paste-steps muted small">
          <li>Pick the template type (matches desktop Settings → Templates).</li>
          <li>Upload or drag-and-drop the .xlsx from your job folder.</li>
          <li>Click <strong>Fill &amp; Download</strong> — open the downloaded file in Excel.</li>
        </ol>

        <label>
          Template type
          <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            {EXCEL_TEMPLATE_FILES.map((t: ExcelTemplateFile) => (
              <option key={t.file} value={t.file}>
                {templateDisplayName(t.file)}
              </option>
            ))}
          </select>
        </label>

        <div
          className={`excel-drop-zone${dragOver ? " excel-drop-zone-dragover" : ""}${uploadedName ? " excel-drop-zone-has-file" : ""}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => uploadRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              uploadRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload Excel template"
        >
          <input
            ref={uploadRef}
            type="file"
            hidden
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
          />
          {uploadedName ? (
            <>
              <strong>{uploadedName}</strong>
              <span className="muted small">Drop another file or click to replace</span>
            </>
          ) : (
            <>
              <strong>Drop Excel template here</strong>
              <span className="muted small">or click to browse (.xlsx, .xlsm, .xls)</span>
            </>
          )}
        </div>

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={filling || !uploadedBytes}
            onClick={() => void onFillAndDownload()}
          >
            {filling ? "Filling…" : "Fill & Download"}
          </button>
        </div>

        {selectedConfig && (
          <p className="muted small">
            {filledCount}/{preview.length} fields have values · uses desktop cell mappings
            {selectedConfig.rename_on_fill?.enabled && " · renames 000 → job # in filename"}
          </p>
        )}
      </section>

      {selectedConfig && (
        <details className="card excel-paste-preview" open>
          <summary className="muted small">
            Field preview — {templateDisplayName(selectedConfig.file)}
          </summary>
          <p className="muted small excel-paste-template-path">{selectedConfig.file}</p>
          <div className="table-wrap">
            <table className="data-table compact excel-paste-table">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Field</th>
                  <th>Merged</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((f) => (
                  <tr key={`${f.cell}-${f.key}`} className={!f.value.trim() ? "excel-paste-empty" : undefined}>
                    <td>{f.cell}</td>
                    <td>{f.label}</td>
                    <td>{f.merged ? "Yes" : "No"}</td>
                    <td className="excel-paste-value">{f.value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="card excel-paste-mappings-help">
        <summary className="muted small">How to add or change template mappings</summary>
        <div className="stack excel-paste-mappings-body small">
          <p>
            Mappings tell JobFlow which Job Info field goes in which Excel cell. The web app uses the
            same mapping list as desktop JobFlow.
          </p>
          <p>
            <strong>Desktop JobFlow (edit mappings today)</strong>
          </p>
          <ol className="excel-paste-steps">
            <li>Open <strong>Settings → Templates → Template Mappings</strong>.</li>
            <li>
              <strong>+ Add File</strong> — path relative to the job folder, e.g.{" "}
              <code>03 - Billing\00 Billing Summary.xlsx</code>.
            </li>
            <li>
              For each field: pick a Job Info field, enter the cell or range (e.g. <code>D3</code> or{" "}
              <code>D3:G3</code>), and turn on <strong>Merged</strong> when the template uses one merged
              block for that value.
            </li>
            <li>
              Click <strong>Save Config</strong> — writes <code>excel_template_mappings.json</code> next to
              your paths file.
            </li>
          </ol>
          <p>
            <strong>Web app</strong> — mappings are bundled from{" "}
            <code>jobflow-web/src/config/excelTemplateMappings.json</code> (copied from desktop{" "}
            <code>json/excel_template_mappings.json</code>). After you save in desktop, copy that JSON into
            the web project and redeploy so new templates appear in the dropdown and auto-match by filename.
          </p>
          <p className="muted">
            Upload auto-match uses the Excel filename (e.g. <code>00 Billing Summary.xlsx</code>). If it
            does not match, pick the template type manually from the list above.
          </p>
        </div>
      </details>
    </div>
  );
}
