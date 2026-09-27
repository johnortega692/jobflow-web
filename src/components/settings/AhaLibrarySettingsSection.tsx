import { FormEvent, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  createLibraryTemplate,
  deleteLibraryTemplate,
  listLibrary,
  setLibraryArchived,
  updateLibraryTemplate,
} from "../../lib/aha/api";
import { V4_ARCHIVE } from "../../lib/aha/bundles";
import { AHA_PROBABILITIES, AHA_SEVERITIES, ahaScopeLabel } from "../../lib/aha/display";
import { equipmentColumns, equipmentRowsFromColumns } from "../../lib/aha/equipmentRows";
import { AHA_STANDARD_PPE_KEY, parseStandardPpe } from "../../lib/aha/ppe";
import { loadOrgSettingsBlob, saveOrgSettingsPatch } from "../../lib/orgSettings";
import { supabase } from "../../lib/supabase";
import type { AhaLibraryItem, AhaLibraryStep, AhaProb, AhaScope, AhaSev } from "../../lib/aha/types";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import type { SettingsSectionBindings } from "./settingsSectionTypes";

type DraftStep = {
  key: string;
  name: string;
  hazards: string;
  controls: string;
  osha_refs: string;
  em385_refs: string;
  prob: AhaProb;
  sev: AhaSev;
};

type LibraryDraft = {
  id: string | null;
  name: string;
  scope: AhaScope;
  csi: string;
  equipment: string[];
  training: string[];
  inspection: string[];
  steps: DraftStep[];
};

const SCOPES: AhaScope[] = ["paint", "wallcovering", "access", "general"];

const SCOPE_FILTERS: { id: "all" | AhaScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paint", label: "Paint" },
  { id: "wallcovering", label: "Wallcovering" },
  { id: "access", label: "Access" },
  { id: "general", label: "General" },
];

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function blankStep(): DraftStep {
  return {
    key: crypto.randomUUID(),
    name: "",
    hazards: "",
    controls: "",
    osha_refs: "",
    em385_refs: "",
    prob: "O",
    sev: "M",
  };
}

function draftFromTemplate(item: AhaLibraryItem): LibraryDraft {
  return {
    id: item.id,
    name: item.name,
    scope: item.scope,
    csi: item.csi,
    equipment: equipmentColumns(item.equipment_rows).equipment,
    training: equipmentColumns(item.equipment_rows).training,
    inspection: equipmentColumns(item.equipment_rows).inspection,
    steps: item.steps.map((step) => ({
      key: step.id || crypto.randomUUID(),
      name: step.name,
      hazards: step.hazards.join("\n"),
      controls: step.controls.join("\n"),
      osha_refs: step.osha_refs,
      em385_refs: step.em385_refs,
      prob: step.prob,
      sev: step.sev,
    })),
  };
}

function newDraft(): LibraryDraft {
  return {
    id: null,
    name: "",
    scope: "paint",
    csi: "",
    equipment: [],
    training: [],
    inspection: [],
    steps: [blankStep()],
  };
}

function stepsForSave(steps: DraftStep[]): AhaLibraryStep[] {
  return steps
    .map((step) => ({
      name: step.name.trim(),
      hazards: linesOf(step.hazards),
      controls: linesOf(step.controls),
      osha_refs: step.osha_refs.trim(),
      em385_refs: step.em385_refs.trim(),
      prob: step.prob,
      sev: step.sev,
    }))
    .filter((step) => step.name || step.hazards.length || step.controls.length || step.osha_refs || step.em385_refs);
}

function TextListField({
  label,
  items,
  disabled,
  onChange,
}: {
  label: string;
  items: string[];
  disabled: boolean;
  onChange: (items: string[]) => void;
}) {
  const [value, setValue] = useState("");

  function add() {
    const next = value.trim();
    if (!next) return;
    onChange([...items, next]);
    setValue("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  }

  return (
    <div className="stack">
      <span>{label}</span>
      {items.length > 0 && (
        <div className="paint-spec-sections-chips" role="list" aria-label={label}>
          {items.map((item, index) => (
            <span key={`${item}-${index}`} className="paint-spec-chip" role="listitem">
              <span className="paint-spec-chip-label">{item}</span>
              <button
                type="button"
                className="paint-spec-chip-remove"
                aria-label={`Remove ${item}`}
                disabled={disabled}
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={value}
        disabled={disabled}
        placeholder="Add and press Enter"
        aria-label={`Add to ${label}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

export function AhaLibrarySettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const [templates, setTemplates] = useState<AhaLibraryItem[]>([]);
  const [scopeFilter, setScopeFilter] = useState<"all" | AhaScope>("all");
  const [draft, setDraft] = useState<LibraryDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [standardPpe, setStandardPpe] = useState<string[]>([]);
  const [ppeInput, setPpeInput] = useState("");
  const openedRef = useRef<string | null>(null);
  const ppeBaseline = useRef("[]");
  const dirtyRef = useRef(false);
  const editorDirty = draft !== null && JSON.stringify(draft) !== openedRef.current;
  const ppeDirty = JSON.stringify(standardPpe) !== ppeBaseline.current;
  dirtyRef.current = editorDirty || ppeDirty;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listLibrary(), loadOrgSettingsBlob()])
      .then(([rows, org]) => {
        if (cancelled) return;
        setTemplates(rows);
        const ppe = parseStandardPpe(org[AHA_STANDARD_PPE_KEY]);
        ppeBaseline.current = JSON.stringify(ppe);
        setStandardPpe(ppe);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the AHA library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(editorDirty || ppeDirty);
  }, [editorDirty, ppeDirty, onDirtyChange]);

  function openDraft(next: LibraryDraft) {
    openedRef.current = JSON.stringify(next);
    setDraft(next);
    setMessage(null);
    setError(null);
  }

  function closeDraft() {
    if (editorDirty && !window.confirm("Discard unsaved changes to this template?")) return;
    setDraft(null);
  }

  const persist = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      let savedPpe = false;
      if (JSON.stringify(standardPpe) !== ppeBaseline.current) {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData.user?.id;
        if (!userId) throw new Error("Sign in to save standard PPE.");
        const saveError = await saveOrgSettingsPatch({ [AHA_STANDARD_PPE_KEY]: standardPpe }, userId);
        if (saveError) throw new Error(saveError);
        ppeBaseline.current = JSON.stringify(standardPpe);
        savedPpe = true;
      }
      if (!draft) {
        if (savedPpe) setMessage("Standard PPE saved.");
        return true;
      }
      const input = {
        name: draft.name,
        scope: draft.scope,
        csi: draft.csi,
        equipment_rows: equipmentRowsFromColumns(draft.equipment, draft.training, draft.inspection),
        steps: stepsForSave(draft.steps),
      };
      const saved = draft.id ? await updateLibraryTemplate(draft.id, input) : await createLibraryTemplate(input);
      setTemplates((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDraft(null);
      setMessage(draft.id ? "Template updated." : "Template added to the library.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the template.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, readOnly, standardPpe]);

  useEffect(() => {
    if (loading || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        setDraft(null);
        setMessage(null);
        setError(null);
      },
      getIsDirty: () => dirtyRef.current,
    });
  }, [loading, onBindActions, persist, readOnly]);

  function patchDraft(patch: Partial<LibraryDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function patchStep(key: string, patch: Partial<DraftStep>) {
    setDraft((current) =>
      current
        ? { ...current, steps: current.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)) }
        : current,
    );
  }

  async function onDelete() {
    if (!draft?.id || readOnly) return;
    const label = draft.name.trim() || "this template";
    if (!window.confirm(`Delete ${label}? Jobs that already used it keep their copy.`)) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await deleteLibraryTemplate(draft.id);
      setTemplates((current) => current.filter((item) => item.id !== draft.id));
      setDraft(null);
      setMessage("Template deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the template.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void persist();
  }

  function addStandardPpe() {
    const next = ppeInput.trim();
    setPpeInput("");
    if (!next || standardPpe.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    setStandardPpe((current) => [...current, next]);
  }

  async function archiveReplaced() {
    const ids = templates
      .filter(
        (item) =>
          !item.archived && (V4_ARCHIVE.slugs.includes(item.slug) || V4_ARCHIVE.names.includes(item.name)),
      )
      .map((item) => item.id);
    if (!ids.length) return;
    setSaving(true);
    setError(null);
    try {
      await setLibraryArchived(ids, true);
      setTemplates((current) => current.map((item) => (ids.includes(item.id) ? { ...item, archived: true } : item)));
      setMessage("Replaced templates archived.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive those templates.");
    } finally {
      setSaving(false);
    }
  }

  async function unarchive(id: string) {
    setSaving(true);
    setError(null);
    try {
      await setLibraryArchived([id], false);
      setTemplates((current) => current.map((item) => (item.id === id ? { ...item, archived: false } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unarchive that template.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Loading AHA library…</p>;

  return (
    <div className="stack">
      {readOnly && <SharedSettingsNotice />}
      <div>
        <h2>AHA library</h2>
        <p className="muted small">
          Company templates for Activity Hazard Analyses. New templates show up under + From library on a job. Edits
          made on a job stay on that job.
        </p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-info">{message}</div>}
      {!draft &&
        templates.some(
          (item) =>
            !item.archived && (V4_ARCHIVE.slugs.includes(item.slug) || V4_ARCHIVE.names.includes(item.name)),
        ) && (
          <div className="banner banner-info aha-archive-banner">
            <span>
              v4 replaces Paints &amp; coatings, Interior brush &amp; roll, Airless spray, and Surface prep. Archive
              them?
            </span>
            {!readOnly && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void archiveReplaced()}>
                Archive
              </button>
            )}
          </div>
        )}

      {draft ? (
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Name
            <input
              value={draft.name}
              disabled={readOnly || saving}
              required
              onChange={(event) => patchDraft({ name: event.target.value })}
            />
          </label>
          <div className="grid-2">
            <label>
              Scope
              <select
                value={draft.scope}
                disabled={readOnly || saving}
                onChange={(event) => patchDraft({ scope: event.target.value as AhaScope })}
              >
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {ahaScopeLabel(scope)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSI
              <input
                value={draft.csi}
                disabled={readOnly || saving}
                placeholder="09 91 23"
                onChange={(event) => patchDraft({ csi: event.target.value })}
              />
            </label>
          </div>

          <div className="stack">
            <div className="row-between">
              <h3>Steps</h3>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={saving}
                  onClick={() => patchDraft({ steps: [...draft.steps, blankStep()] })}
                >
                  + Add step
                </button>
              )}
            </div>
            {draft.steps.length === 0 && <p className="muted small">No steps yet.</p>}
            {draft.steps.map((step, index) => (
              <div key={step.key} className="card stack">
                <div className="row-between">
                  <strong>Step {index + 1}</strong>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={saving}
                      onClick={() => patchDraft({ steps: draft.steps.filter((item) => item.key !== step.key) })}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <label>
                  Step name
                  <input
                    value={step.name}
                    disabled={readOnly || saving}
                    onChange={(event) => patchStep(step.key, { name: event.target.value })}
                  />
                </label>
                <label>
                  Hazards
                  <textarea
                    rows={3}
                    value={step.hazards}
                    disabled={readOnly || saving}
                    placeholder="One hazard per line"
                    onChange={(event) => patchStep(step.key, { hazards: event.target.value })}
                  />
                </label>
                <label>
                  Controls
                  <textarea
                    rows={3}
                    value={step.controls}
                    disabled={readOnly || saving}
                    placeholder="One control per line"
                    onChange={(event) => patchStep(step.key, { controls: event.target.value })}
                  />
                </label>
                <div className="grid-2">
                  <label>
                    OSHA refs
                    <input
                      value={step.osha_refs}
                      disabled={readOnly || saving}
                      onChange={(event) => patchStep(step.key, { osha_refs: event.target.value })}
                    />
                  </label>
                  <label>
                    EM 385-1-1 refs
                    <input
                      value={step.em385_refs}
                      disabled={readOnly || saving}
                      onChange={(event) => patchStep(step.key, { em385_refs: event.target.value })}
                    />
                  </label>
                  <label>
                    Probability
                    <select
                      value={step.prob}
                      disabled={readOnly || saving}
                      onChange={(event) => patchStep(step.key, { prob: event.target.value as AhaProb })}
                    >
                      {AHA_PROBABILITIES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Severity
                    <select
                      value={step.sev}
                      disabled={readOnly || saving}
                      onChange={(event) => patchStep(step.key, { sev: event.target.value as AhaSev })}
                    >
                      {AHA_SEVERITIES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <TextListField
            label="Equipment to be used"
            items={draft.equipment}
            disabled={readOnly || saving}
            onChange={(equipment) => patchDraft({ equipment })}
          />
          <TextListField
            label="Training requirements"
            items={draft.training}
            disabled={readOnly || saving}
            onChange={(training) => patchDraft({ training })}
          />
          <TextListField
            label="Inspection requirements"
            items={draft.inspection}
            disabled={readOnly || saving}
            onChange={(inspection) => patchDraft({ inspection })}
          />

          <div className="row-between">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={closeDraft}>
              Back
            </button>
            {!readOnly && (
              <div className="row-gap">
                {draft.id && (
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onDelete()}>
                    Delete
                  </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : draft.id ? "Save template" : "Add to library"}
                </button>
              </div>
            )}
          </div>
        </form>
      ) : (
        <div className="stack">
          <div className="filter-chips" role="group" aria-label="Filter library by scope">
            {SCOPE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`filter-chip${scopeFilter === filter.id ? " filter-chip--active" : ""}`}
                aria-pressed={scopeFilter === filter.id}
                onClick={() => setScopeFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {!readOnly && (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => openDraft(newDraft())}>
                + Add template
              </button>
            </div>
          )}
          <div className="stack">
            <h3>Standard PPE</h3>
            <p className="muted small">Printed on every JHA. A job can add PPE. It cannot remove these.</p>
            <div className="paint-spec-sections-chips" role="list" aria-label="Standard PPE">
              {standardPpe.map((item) => (
                <span key={item.toLowerCase()} className="paint-spec-chip" role="listitem">
                  <span className="paint-spec-chip-label">{item}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="paint-spec-chip-remove"
                      aria-label={`Remove ${item}`}
                      disabled={saving}
                      onClick={() => setStandardPpe((current) => current.filter((entry) => entry !== item))}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!readOnly && (
              <input
                value={ppeInput}
                disabled={saving}
                placeholder="Add PPE and press Enter"
                aria-label="Add standard PPE"
                onChange={(event) => setPpeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addStandardPpe();
                }}
              />
            )}
          </div>
          {templates.filter((item) => !item.archived && (scopeFilter === "all" || item.scope === scopeFilter)).length === 0 ? (
            <p className="muted">{templates.length === 0 ? "No library templates yet." : "No templates in this scope."}</p>
          ) : (
            templates
              .filter((item) => !item.archived && (scopeFilter === "all" || item.scope === scopeFilter))
              .map((item) => (
              <div key={item.id} className="row-between">
                <div>
                  <strong>{item.name}</strong>
                  <p className="muted small">
                    {ahaScopeLabel(item.scope)} · {item.csi || "—"} · {item.steps.length}{" "}
                    {item.steps.length === 1 ? "step" : "steps"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openDraft(draftFromTemplate(item))}
                >
                  {readOnly ? "View" : "Edit"}
                </button>
              </div>
            ))
          )}
          {templates.some((item) => item.archived && (scopeFilter === "all" || item.scope === scopeFilter)) && (
            <details className="aha-archived">
              <summary>Archived</summary>
              <div className="stack">
                {templates
                  .filter((item) => item.archived && (scopeFilter === "all" || item.scope === scopeFilter))
                  .map((item) => (
                    <div key={item.id} className="row-between">
                      <div>
                        <strong>{item.name}</strong>
                        <p className="muted small">
                          {ahaScopeLabel(item.scope)} · {item.csi || "—"} · {item.steps.length}{" "}
                          {item.steps.length === 1 ? "step" : "steps"}
                        </p>
                      </div>
                      <div className="row-gap">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openDraft(draftFromTemplate(item))}
                        >
                          {readOnly ? "View" : "Edit"}
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={saving}
                            onClick={() => void unarchive(item.id)}
                          >
                            Unarchive
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
