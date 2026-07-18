import { useState } from "react";
import {
  appendBucketsUnique,
  bucketLabel,
  bucketMetrics,
  bucketSnapshot,
  costCodeRecordKey,
  costCodesForTemplate,
  costClassOptionsForCode,
  deleteBucketIndices,
  fmtCell,
  formatCostCode,
  formatCostCodeRecord,
  makeBucketFromCode,
  parseCostClassChoices,
  resolveCostClass,
  savedTemplateNames,
} from "../../lib/budgetMakerCore";
import { saveBudgetLibrary } from "../../lib/budgetLibrary";
import {
  TEMPLATE_OPTIONS,
  type BudgetBucket,
  type BudgetLibrary,
  type BudgetMakerData,
  type CostCodeRecord,
} from "../../types/budgetMaker";

function classLabelForValue(library: BudgetLibrary, costClass: string): string {
  for (const rec of library.cost_classes) {
    if (String(rec.cost_class) === costClass) {
      const gl = rec.gl_acct ? `${rec.gl_acct} / ${rec.cost_class}` : rec.cost_class;
      return `${gl} – ${rec.description}`;
    }
  }
  return costClass;
}

function findCodeKeyForBucket(
  library: BudgetLibrary,
  bucket: BudgetBucket | undefined,
  options: CostCodeRecord[],
): string {
  if (!bucket) return options[0] ? costCodeRecordKey(options[0]) : "";
  const exact =
    library.cost_codes.find(
      (c) =>
        fmtCell(c.cost_code) === fmtCell(bucket.cost_code) &&
        fmtCell(c.cost_class) === fmtCell(bucket.cost_class),
    ) ??
    library.cost_codes.find((c) => fmtCell(c.cost_code) === fmtCell(bucket.cost_code));
  if (!exact) return options[0] ? costCodeRecordKey(options[0]) : "";
  const key = costCodeRecordKey(exact);
  return options.some((c) => costCodeRecordKey(c) === key) ? key : costCodeRecordKey(options[0] ?? exact);
}

function BudgetBucketEditor({
  library,
  bucket,
  existingBuckets = [],
  onSave,
  onCancel,
}: {
  library: BudgetLibrary;
  bucket?: BudgetBucket;
  existingBuckets?: BudgetBucket[];
  onSave: (b: BudgetBucket) => void;
  onCancel: () => void;
}) {
  const initialTemplate = bucket?.template_type ?? null;
  const initialLabel =
    TEMPLATE_OPTIONS.find((o) => o.key === initialTemplate)?.label ?? "Custom";
  const [templateLabel, setTemplateLabel] = useState(initialLabel);
  const templateType = TEMPLATE_OPTIONS.find((o) => o.label === templateLabel)?.key ?? null;
  const codeOptions = costCodesForTemplate(library, templateType);
  const [codeKey, setCodeKey] = useState(() => findCodeKeyForBucket(library, bucket, codeOptions));
  const codeRec = codeOptions.find((c) => costCodeRecordKey(c) === codeKey) ?? codeOptions[0];
  const classOptions = costClassOptionsForCode(library, codeRec, templateType);
  const defaultClass = codeRec ? resolveCostClass(codeRec, templateType) : bucket?.cost_class ?? "";
  const [costClass, setCostClass] = useState(bucket?.cost_class ?? defaultClass);
  const classLocked = Boolean(codeRec && /^\d+$/.test(fmtCell(codeRec.cost_class)));

  function pickClassForCode(rec: CostCodeRecord, nextTemplateType: string | null): string {
    const explicit = fmtCell(rec.cost_class);
    if (/^\d+$/.test(explicit)) return explicit;

    const options = costClassOptionsForCode(library, rec, nextTemplateType);
    const resolved = resolveCostClass(rec, nextTemplateType);
    const used = new Set(
      existingBuckets
        .filter((b) => fmtCell(b.cost_code) === fmtCell(rec.cost_code))
        .map((b) => fmtCell(b.cost_class)),
    );
    const unused = options.find((c) => !used.has(fmtCell(c.cost_class)));
    if (unused) return String(unused.cost_class);
    if (options.some((c) => String(c.cost_class) === resolved)) return resolved;
    return String(options[0]?.cost_class ?? resolved);
  }

  function syncClassFromSelection(nextKey: string, nextTemplateType: string | null) {
    const rec = costCodesForTemplate(library, nextTemplateType).find((c) => costCodeRecordKey(c) === nextKey);
    if (!rec) return;
    setCostClass(pickClassForCode(rec, nextTemplateType));
  }

  function onTemplateChange(label: string) {
    setTemplateLabel(label);
    const nextType = TEMPLATE_OPTIONS.find((o) => o.label === label)?.key ?? null;
    const nextCodes = costCodesForTemplate(library, nextType);
    const keep = nextCodes.find((c) => costCodeRecordKey(c) === codeKey);
    const nextRec = keep ?? nextCodes[0];
    if (nextRec) {
      const nextKey = costCodeRecordKey(nextRec);
      setCodeKey(nextKey);
      setCostClass(pickClassForCode(nextRec, nextType));
    }
  }

  function onCodeKeyChange(nextKey: string) {
    setCodeKey(nextKey);
    syncClassFromSelection(nextKey, templateType);
  }

  function submit() {
    if (!codeRec) return;
    const b = makeBucketFromCode(codeRec, templateType);
    b.cost_class = costClass;
    if (bucket?.notes) b.notes = bucket.notes;
    onSave(b);
  }

  if (!library.cost_codes.length || !library.cost_classes.length) {
    return (
      <div className="banner banner-error">
        Add cost codes and cost classes in Settings first.
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="card stack budget-bucket-editor">
      <label>
        Template
        <select value={templateLabel} onChange={(e) => onTemplateChange(e.target.value)}>
          {TEMPLATE_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cost code
        <select value={codeKey} onChange={(e) => onCodeKeyChange(e.target.value)}>
          {codeOptions.map((c) => {
            const key = costCodeRecordKey(c);
            return (
              <option key={key} value={key}>
                {formatCostCodeRecord(c)}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Cost class
        <select
          value={costClass}
          disabled={classLocked}
          onChange={(e) => setCostClass(e.target.value)}
        >
          {classOptions.map((c, i) => (
            <option key={`${c.cost_class}-${c.gl_acct}-${i}`} value={c.cost_class}>
              {classLabelForValue(library, String(c.cost_class))}
            </option>
          ))}
        </select>
      </label>
      {codeRec && parseCostClassChoices(codeRec.cost_class)?.length ? (
        <p className="muted small">
          This code allows more than one class — pick <strong>4</strong> (owned) or <strong>5</strong> (rented).
          The same cost code can appear twice with different classes.
        </p>
      ) : classLocked ? (
        <p className="muted small">
          Class <strong>{costClass}</strong> comes from this cost code row in your library.
        </p>
      ) : null}
      <div className="row-gap">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={submit}>
          OK
        </button>
      </div>
    </div>
  );
}

export function BudgetBucketsPanel({
  userId,
  library,
  draft,
  onChange,
  onLibraryChange,
  onError,
  canEditCatalog = false,
}: {
  userId: string;
  library: BudgetLibrary;
  draft: BudgetMakerData;
  onChange: (patch: Partial<BudgetMakerData>) => void;
  onLibraryChange: (lib: BudgetLibrary) => void;
  onError: (message: string | null) => void;
  /** Admin: save/delete templates and set company default. */
  canEditCatalog?: boolean;
}) {
  const [templatePick, setTemplatePick] = useState(library.default_bucket_template || "");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const templates = library.bucket_templates;
  const names = savedTemplateNames(library);

  function reportError(message: string | null) {
    onError(message);
  }

  function loadTemplate(name: string, mode: "replace" | "append" | "cancel") {
    if (mode === "cancel") return;
    const tpl = templates.find((t) => t.name === name);
    if (!tpl?.buckets?.length) {
      reportError(`Template "${name}" not found or empty.`);
      return;
    }
    const snapshot = tpl.buckets.map(bucketSnapshot);
    if (mode === "replace") {
      onChange({
        buckets: snapshot,
        loaded_template_name: name,
        lines: draft.lines.map((l) => ({ ...l, Bucket: "" })),
      });
    } else {
      const { buckets, added } = appendBucketsUnique(draft.buckets, snapshot);
      onChange({ buckets, loaded_template_name: name });
      if (!added) reportError("All bucket rows from template already exist.");
    }
    reportError(null);
  }

  function onLoadTemplate() {
    if (!templatePick) return;
    if (draft.buckets.length) {
      const choice = window.prompt(
        `Load "${templatePick}"?\nType R to replace buckets, A to append, or Cancel.`,
        "R",
      );
      if (!choice || choice.toUpperCase() === "C") return;
      loadTemplate(templatePick, choice.toUpperCase().startsWith("A") ? "append" : "replace");
    } else {
      loadTemplate(templatePick, "replace");
    }
  }

  async function saveCurrentTemplate() {
    if (!draft.buckets.length) {
      reportError("Add bucket rows first.");
      return;
    }
    const name = window.prompt("Template name:");
    if (!name?.trim()) return;
    const snapshot = draft.buckets.map(bucketSnapshot);
    const existing = templates.findIndex((t) => t.name === name.trim());
    const nextTemplates = [...templates];
    const entry = { name: name.trim(), buckets: snapshot };
    if (existing >= 0) {
      if (!window.confirm(`Replace existing template "${name.trim()}"?`)) return;
      nextTemplates[existing] = entry;
    } else {
      nextTemplates.push(entry);
    }
    const nextLib = {
      ...library,
      bucket_templates: nextTemplates,
      default_bucket_template: library.default_bucket_template || name.trim(),
    };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) {
      reportError(err);
      return;
    }
    onLibraryChange(nextLib);
    setTemplatePick(name.trim());
  }

  async function deleteTemplate() {
    if (!templatePick) return;
    if (!window.confirm(`Delete template "${templatePick}"?`)) return;
    const nextLib = {
      ...library,
      bucket_templates: templates.filter((t) => t.name !== templatePick),
      default_bucket_template:
        library.default_bucket_template === templatePick ? "" : library.default_bucket_template,
    };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) {
      reportError(err);
      return;
    }
    onLibraryChange(nextLib);
    setTemplatePick("");
  }

  async function setDefaultTemplate() {
    if (!templatePick) return;
    const nextLib = { ...library, default_bucket_template: templatePick };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) {
      reportError(err);
      return;
    }
    onLibraryChange(nextLib);
    if (!draft.buckets.length) {
      loadTemplate(templatePick, "replace");
    }
    reportError(null);
  }

  async function clearDefaultTemplate() {
    if (!library.default_bucket_template) return;
    const nextLib = { ...library, default_bucket_template: "" };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) reportError(err);
    else onLibraryChange(nextLib);
  }

  function deleteSelected() {
    const indices = [...selected];
    if (!indices.length) return;
    if (!window.confirm(`Delete ${indices.length} bucket row(s)?`)) return;
    const { buckets, lines } = deleteBucketIndices(draft.buckets, draft.lines, indices);
    onChange({ buckets, lines });
    setSelected(new Set());
  }

  const budgetTotal = draft.buckets.reduce((s, _, i) => s + bucketMetrics(i, draft.lines).amount, 0);

  return (
    <div className="stack budget-settings-panel">
      <div className="row-gap wrap">
          <label className="budget-inline-label">
            Template
            <select value={templatePick} onChange={(e) => setTemplatePick(e.target.value)}>
              <option value="">-- Select --</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLoadTemplate}>
            Load
          </button>
          {canEditCatalog && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveCurrentTemplate()}>
                Save current…
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deleteTemplate()}>
                Delete saved
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setDefaultTemplate()}>
                Set as default
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clearDefaultTemplate()}>
                Clear default
              </button>
            </>
          )}
          {library.default_bucket_template && (
            <span className="muted small">Default at startup: {library.default_bucket_template}</span>
          )}
        </div>

        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            Add bucket row…
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={selected.size !== 1}
            onClick={() => setEditingIdx([...selected][0])}
          >
            Edit selected
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!selected.size} onClick={deleteSelected}>
            Delete selected
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (window.confirm("Remove all bucket rows?")) {
                onChange({ buckets: [], lines: draft.lines.map((l) => ({ ...l, Bucket: "" })), loaded_template_name: "" });
              }
            }}
          >
            Clear all
          </button>
        </div>

        {(adding || editingIdx != null) && (
          <BudgetBucketEditor
            library={library}
            bucket={editingIdx != null ? draft.buckets[editingIdx] : undefined}
            existingBuckets={editingIdx != null ? draft.buckets.filter((_, i) => i !== editingIdx) : draft.buckets}
            onCancel={() => {
              setAdding(false);
              setEditingIdx(null);
            }}
            onSave={(b) => {
              if (editingIdx != null) {
                const buckets = draft.buckets.map((row, i) => (i === editingIdx ? b : row));
                onChange({ buckets });
                setEditingIdx(null);
              } else {
                const { buckets, added } = appendBucketsUnique(draft.buckets, [b]);
                if (!added) {
                  reportError(
                    `A bucket with cost code ${formatCostCode(b.cost_code, library, b.cost_class)} and class ${b.cost_class} already exists. Change the class (e.g. 5 for rented equipment) or edit the existing row.`,
                  );
                } else onChange({ buckets });
                setAdding(false);
              }
            }}
          />
        )}

        <div className="table-wrap settings-scroll-table-wrap">
          <table className="budget-table-select">
            <thead>
              <tr>
                <th></th>
                <th>Bucket</th>
                <th>Template</th>
                <th>Cost code</th>
                <th>Class</th>
                <th>Lines</th>
                <th>Hours</th>
                <th>Amount</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {draft.buckets.map((bucket, i) => {
                const m = bucketMetrics(i, draft.lines);
                if (draft.hide_zero_amounts && m.amount === 0) return null;
                const pct = budgetTotal > 0 ? `${((m.amount / budgetTotal) * 100).toFixed(1)}%` : "0%";
                return (
                  <tr key={i}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>{bucketLabel(bucket, i, library)}</td>
                    <td>{bucket.template_type ?? ""}</td>
                    <td>{formatCostCode(bucket.cost_code, library, bucket.cost_class)}</td>
                    <td>{bucket.cost_class}</td>
                    <td>{m.lines}</td>
                    <td>{m.hours ? m.hours.toFixed(1) : ""}</td>
                    <td>${m.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>{pct}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    </div>
  );
}

export { BudgetBucketEditor };
