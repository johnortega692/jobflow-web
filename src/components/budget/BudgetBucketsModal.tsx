import { useState } from "react";
import {
  appendBucketsUnique,
  bucketLabel,
  bucketMetrics,
  bucketSnapshot,
  costCodesForTemplate,
  deleteBucketIndices,
  formatCostCode,
  makeBucketFromCode,
  resolveCostClass,
  savedTemplateNames,
} from "../../lib/budgetMakerCore";
import { saveBudgetLibrary } from "../../lib/budgetLibrary";
import {
  TEMPLATE_OPTIONS,
  type BudgetBucket,
  type BudgetLibrary,
  type BudgetMakerData,
} from "../../types/budgetMaker";

type Props = {
  userId: string;
  library: BudgetLibrary;
  draft: BudgetMakerData;
  onClose: () => void;
  onChange: (patch: Partial<BudgetMakerData>) => void;
  onLibraryChange: (lib: BudgetLibrary) => void;
};

function BucketEditor({
  library,
  bucket,
  onSave,
  onCancel,
}: {
  library: BudgetLibrary;
  bucket?: BudgetBucket;
  onSave: (b: BudgetBucket) => void;
  onCancel: () => void;
}) {
  const initialTemplate = bucket?.template_type ?? null;
  const initialLabel =
    TEMPLATE_OPTIONS.find((o) => o.key === initialTemplate)?.label ?? "Custom";
  const [templateLabel, setTemplateLabel] = useState(initialLabel);
  const templateType = TEMPLATE_OPTIONS.find((o) => o.label === templateLabel)?.key ?? null;
  const codeOptions = costCodesForTemplate(library, templateType);
  const [code, setCode] = useState(bucket?.cost_code ?? codeOptions[0]?.cost_code ?? "");
  const codeRec = codeOptions.find((c) => c.cost_code === code) ?? codeOptions[0];
  const classOptions = library.cost_classes.filter((c) => c.cost_class);
  const resolvedClass = codeRec ? resolveCostClass(codeRec, templateType) : bucket?.cost_class ?? "";

  function submit() {
    if (!codeRec) return;
    const b = makeBucketFromCode(codeRec, templateType);
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
        <select value={templateLabel} onChange={(e) => setTemplateLabel(e.target.value)}>
          {TEMPLATE_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cost code
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {codeOptions.map((c) => (
            <option key={c.cost_code} value={c.cost_code}>
              {formatCostCode(c.cost_code, library)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cost class
        <select
          value={resolvedClass}
          onChange={() => {}}
          disabled
        >
          {classOptions.map((c) => (
            <option key={c.cost_class} value={c.cost_class}>
              {c.gl_acct ? `${c.gl_acct} / ${c.cost_class}` : c.cost_class} – {c.description}
            </option>
          ))}
        </select>
      </label>
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

export function BudgetBucketsModal({
  userId,
  library,
  draft,
  onClose,
  onChange,
  onLibraryChange,
}: Props) {
  const [templatePick, setTemplatePick] = useState(library.default_bucket_template || "");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const templates = library.bucket_templates;
  const names = savedTemplateNames(library);

  function loadTemplate(name: string, mode: "replace" | "append" | "cancel") {
    if (mode === "cancel") return;
    const tpl = templates.find((t) => t.name === name);
    if (!tpl?.buckets?.length) {
      setError(`Template "${name}" not found or empty.`);
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
      if (!added) setError("All bucket rows from template already exist.");
    }
    setError(null);
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
      setError("Add bucket rows first.");
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
    const nextLib = { ...library, bucket_templates: nextTemplates };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) {
      setError(err);
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
      setError(err);
      return;
    }
    onLibraryChange(nextLib);
    setTemplatePick("");
  }

  async function setDefaultTemplate() {
    if (!templatePick) return;
    const nextLib = { ...library, default_bucket_template: templatePick };
    const err = await saveBudgetLibrary(userId, nextLib);
    if (err) setError(err);
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack budget-modal budget-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Buckets & templates</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}

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
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveCurrentTemplate()}>
            Save current…
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deleteTemplate()}>
            Delete saved
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setDefaultTemplate()}>
            Set as default
          </button>
          {library.default_bucket_template && (
            <span className="muted small">Default: {library.default_bucket_template}</span>
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
          <BucketEditor
            library={library}
            bucket={editingIdx != null ? draft.buckets[editingIdx] : undefined}
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
                if (!added) setError("That bucket row already exists.");
                else onChange({ buckets });
                setAdding(false);
              }
            }}
          />
        )}

        <div className="table-wrap">
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
                    <td>{formatCostCode(bucket.cost_code, library)}</td>
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

        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
