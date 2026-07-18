import { useEffect, useState } from "react";
import {
  appendBucketsUnique,
  bucketLabel,
  bucketSnapshot,
  formatCostCode,
  savedTemplateNames,
} from "../../lib/budgetMakerCore";
import type { BudgetBucket, BudgetLibrary, BucketTemplate } from "../../types/budgetMaker";
import { BudgetBucketEditor } from "./BudgetBucketsModal";

type Props = {
  library: BudgetLibrary;
  onLibraryChange: (lib: BudgetLibrary) => void;
  onError: (message: string | null) => void;
  readOnly?: boolean;
};

function emptyTemplate(name: string): BucketTemplate {
  return { name, buckets: [] };
}

/** Company saved bucket templates with inline edit. */
export function BudgetTemplatesPanel({ library, onLibraryChange, onError, readOnly = false }: Props) {
  const names = savedTemplateNames(library);
  const [selected, setSelected] = useState(library.default_bucket_template || names[0] || "");
  const [nameDraft, setNameDraft] = useState(selected);
  const [buckets, setBuckets] = useState<BudgetBucket[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!selected) {
      setNameDraft("");
      setBuckets([]);
      return;
    }
    const tpl = library.bucket_templates.find((t) => t.name === selected);
    setNameDraft(tpl?.name ?? selected);
    setBuckets((tpl?.buckets ?? []).map(bucketSnapshot));
    setEditingIdx(null);
    setAdding(false);
    setSelectedRows(new Set());
  }, [selected, library.bucket_templates]);

  function commitTemplate(nextName: string, nextBuckets: BudgetBucket[]) {
    const trimmed = nextName.trim();
    if (!trimmed) {
      onError("Template name is required.");
      return false;
    }
    const nameTaken = library.bucket_templates.some(
      (t) => t.name === trimmed && t.name !== selected,
    );
    if (nameTaken) {
      onError(`A template named "${trimmed}" already exists.`);
      return false;
    }

    const entry: BucketTemplate = {
      name: trimmed,
      buckets: nextBuckets.map(bucketSnapshot),
    };
    let nextTemplates = [...library.bucket_templates];
    if (selected) {
      const idx = nextTemplates.findIndex((t) => t.name === selected);
      if (idx >= 0) nextTemplates[idx] = entry;
      else nextTemplates.push(entry);
    } else {
      nextTemplates.push(entry);
    }

    const nextDefault =
      library.default_bucket_template === selected ? trimmed : library.default_bucket_template;

    onLibraryChange({
      ...library,
      bucket_templates: nextTemplates,
      default_bucket_template: nextDefault,
    });
    setSelected(trimmed);
    onError(null);
    return true;
  }

  function applyBuckets(nextBuckets: BudgetBucket[]) {
    setBuckets(nextBuckets);
    if (!selected && !nameDraft.trim()) {
      onError("Name the template first, then add buckets.");
      return;
    }
    const name = nameDraft.trim() || selected;
    if (!name) return;
    commitTemplate(name, nextBuckets);
  }

  function saveName() {
    if (readOnly) return;
    if (!selected && !nameDraft.trim()) {
      onError("Enter a template name.");
      return;
    }
    commitTemplate(nameDraft, buckets);
  }

  function createNew() {
    if (readOnly) return;
    const base = "New template";
    let name = base;
    let n = 2;
    while (library.bucket_templates.some((t) => t.name === name)) {
      name = `${base} ${n++}`;
    }
    onLibraryChange({
      ...library,
      bucket_templates: [...library.bucket_templates, emptyTemplate(name)],
    });
    setSelected(name);
    onError(null);
  }

  function deleteSelected() {
    if (readOnly || !selected) return;
    if (!window.confirm(`Delete template "${selected}"?`)) return;
    onLibraryChange({
      ...library,
      bucket_templates: library.bucket_templates.filter((t) => t.name !== selected),
      default_bucket_template:
        library.default_bucket_template === selected ? "" : library.default_bucket_template,
    });
    setSelected("");
    onError(null);
  }

  function setAsDefault() {
    if (readOnly || !selected) return;
    onLibraryChange({ ...library, default_bucket_template: selected });
    onError(null);
  }

  function clearDefault() {
    if (readOnly || !library.default_bucket_template) return;
    onLibraryChange({ ...library, default_bucket_template: "" });
    onError(null);
  }

  function deleteSelectedBuckets() {
    const indices = [...selectedRows].sort((a, b) => b - a);
    if (!indices.length) return;
    if (!window.confirm(`Remove ${indices.length} bucket row(s) from this template?`)) return;
    const next = buckets.filter((_, i) => !selectedRows.has(i));
    setSelectedRows(new Set());
    applyBuckets(next);
  }

  return (
    <div className="stack budget-settings-panel">
      <p className="muted small">
        Edit company templates here. Changes apply after you click <strong>Save budget catalog</strong>.
        Jobs can still load a template from Budget → Buckets…
      </p>

      <div className="row-gap wrap">
        <label className="budget-inline-label">
          Template
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!names.length && !selected}
          >
            <option value="">{names.length ? "— Select —" : "No saved templates"}</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
                {n === library.default_bucket_template ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={createNew}>
              New template
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!selected} onClick={setAsDefault}>
              Set as default
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!library.default_bucket_template}
              onClick={clearDefault}
            >
              Clear default
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!selected} onClick={deleteSelected}>
              Delete template
            </button>
          </>
        )}
        {library.default_bucket_template && (
          <span className="muted small">Default at startup: {library.default_bucket_template}</span>
        )}
      </div>

      {(selected || !readOnly) && (
        <div className="card stack">
          <div className="row-gap wrap">
            <label className="budget-inline-label">
              Name
              <input
                value={nameDraft}
                disabled={readOnly}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  if (!readOnly && selected && nameDraft.trim() && nameDraft.trim() !== selected) {
                    saveName();
                  }
                }}
                placeholder="Template name"
              />
            </label>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!nameDraft.trim()}
                onClick={saveName}
              >
                Rename / apply name
              </button>
            )}
          </div>

          {!readOnly && (
            <div className="row-gap wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!selected && !nameDraft.trim()}
                onClick={() => {
                  if (!selected && nameDraft.trim()) {
                    if (!commitTemplate(nameDraft, buckets)) return;
                  }
                  setAdding(true);
                }}
              >
                Add bucket…
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={selectedRows.size !== 1}
                onClick={() => setEditingIdx([...selectedRows][0] ?? null)}
              >
                Edit selected
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!selectedRows.size}
                onClick={deleteSelectedBuckets}
              >
                Remove selected
              </button>
            </div>
          )}

          {(adding || editingIdx != null) && !readOnly && (
            <BudgetBucketEditor
              library={library}
              bucket={editingIdx != null ? buckets[editingIdx] : undefined}
              existingBuckets={
                editingIdx != null ? buckets.filter((_, i) => i !== editingIdx) : buckets
              }
              onCancel={() => {
                setAdding(false);
                setEditingIdx(null);
              }}
              onSave={(b) => {
                if (editingIdx != null) {
                  const next = buckets.map((row, i) => (i === editingIdx ? b : row));
                  setEditingIdx(null);
                  applyBuckets(next);
                } else {
                  const { buckets: next, added } = appendBucketsUnique(buckets, [b]);
                  if (!added) {
                    onError(
                      `A bucket with cost code ${formatCostCode(b.cost_code, library, b.cost_class)} and class ${b.cost_class} already exists.`,
                    );
                  } else {
                    setAdding(false);
                    applyBuckets(next);
                  }
                }
              }}
            />
          )}

          <div className="table-wrap settings-scroll-table-wrap">
            <table className="budget-table-select">
              <thead>
                <tr>
                  {!readOnly && <th></th>}
                  <th>Bucket</th>
                  <th>Type</th>
                  <th>Cost code</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                {!buckets.length && (
                  <tr>
                    <td colSpan={readOnly ? 4 : 5} className="muted">
                      {selected ? "No buckets in this template." : "Select or create a template."}
                    </td>
                  </tr>
                )}
                {buckets.map((bucket, i) => (
                  <tr key={`${bucket.cost_code}-${bucket.cost_class}-${i}`}>
                    {!readOnly && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedRows.has(i)}
                          onChange={(e) => {
                            const next = new Set(selectedRows);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            setSelectedRows(next);
                          }}
                        />
                      </td>
                    )}
                    <td>{bucketLabel(bucket, i, library)}</td>
                    <td>{bucket.template_type ?? ""}</td>
                    <td>{formatCostCode(bucket.cost_code, library, bucket.cost_class)}</td>
                    <td>{bucket.cost_class}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
