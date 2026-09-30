import { useEffect, useMemo, useState } from "react";
import { RECOMMENDED_BUNDLES } from "../../lib/aha/bundles";
import { AHA_CONSIDERATIONS, orderConsiderations } from "../../lib/aha/considerations";
import { ahaScopeLabel, suggestedAhaName } from "../../lib/aha/display";
import { mergeConsiderations } from "../../lib/aha/equipmentRows";
import type { AhaLibraryItem, AhaLibraryStep, AhaScope } from "../../lib/aha/types";

type Mode = "create" | "add";

export type AhaLibraryPick = {
  template: AhaLibraryItem;
  steps: AhaLibraryStep[];
};

type Props = {
  mode: Mode;
  library: AhaLibraryItem[];
  ahaName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: { libraryIds: string[]; name: string; csi: string }) => void;
  onAdd: (picks: AhaLibraryPick[]) => void;
};

type ScopeFilter = "all" | AhaScope;

const SCOPE_FILTERS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paint", label: "Paint" },
  { id: "wallcovering", label: "Wallcovering" },
  { id: "access", label: "Access" },
  { id: "general", label: "General" },
];

const SCOPE_ORDER: AhaScope[] = ["paint", "wallcovering", "access", "general"];

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function considerationLabels(keys: readonly string[]): string[] {
  const present = new Set(orderConsiderations(keys));
  return AHA_CONSIDERATIONS.filter((item) => present.has(item.key)).map((item) => item.label);
}

export function AhaLibraryModal({ mode, library, ahaName, busy, error, onClose, onCreate, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [uncheckedSteps, setUncheckedSteps] = useState<Set<string>>(() => new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [createName, setCreateName] = useState("");
  const [createCsi, setCreateCsi] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [csiTouched, setCsiTouched] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const selected = useMemo(
    () =>
      checkedIds
        .map((id) => library.find((item) => item.id === id))
        .filter((item): item is AhaLibraryItem => Boolean(item)),
    [checkedIds, library],
  );

  const needle = query.trim().toLowerCase();
  const visible = library.filter((item) => {
    if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
    if (!needle) return true;
    return item.name.toLowerCase().includes(needle) || item.csi.toLowerCase().includes(needle);
  });

  function stepOn(templateId: string, index: number): boolean {
    if (mode === "create") return true;
    return !uncheckedSteps.has(`${templateId}:${index}`);
  }

  function includedSteps(template: AhaLibraryItem): AhaLibraryStep[] {
    return template.steps.filter((_, index) => stepOn(template.id, index));
  }

  const contributing = selected.filter((template) => includedSteps(template).length > 0);
  const stepCount = contributing.reduce((sum, template) => sum + includedSteps(template).length, 0);
  const labels = considerationLabels(
    mergeConsiderations(contributing.map((template) => template.considerations)),
  );
  const summary = `${countPhrase(selected.length, "template", "templates")} · ${countPhrase(stepCount, "step", "steps")} · considerations: ${
    labels.length ? labels.join(", ") : "none"
  }`;
  const displayedName = nameTouched ? createName : suggestedAhaName(selected.map((item) => item.scope));
  const displayedCsi = csiTouched ? createCsi : (selected[0]?.csi ?? "");
  const title = mode === "add" ? `Add to ${ahaName.trim() || "Untitled AHA"}` : "Create AHA";
  const titleId = "aha-library-modal-title";

  function clearStepMarks(templateId: string) {
    setUncheckedSteps((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (!key.startsWith(`${templateId}:`)) next.add(key);
      }
      return next;
    });
  }

  function toggleTemplate(id: string) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    clearStepMarks(id);
  }

  function applyBundle(name: string, slugs: string[]) {
    const ids = slugs.flatMap((slug) => {
      const match = library.find((item) => item.slug === slug);
      return match ? [match.id] : [];
    });
    setCheckedIds(ids);
    setUncheckedSteps(new Set());
    setCreateName(name);
    setNameTouched(true);
  }

  function moveGroup(index: number, delta: number) {
    setCheckedIds((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStep(templateId: string, index: number) {
    const key = `${templateId}:${index}`;
    setUncheckedSteps((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    if (busy || selected.length === 0) return;
    if (mode === "create") {
      onCreate({ libraryIds: selected.map((item) => item.id), name: displayedName, csi: displayedCsi });
      return;
    }
    if (stepCount === 0) return;
    onAdd(contributing.map((template) => ({ template, steps: includedSteps(template) })));
  }

  function renderRow(item: AhaLibraryItem) {
    const steps = item.steps.length;
    const checked = checkedIds.includes(item.id);
    return (
      <label key={item.id} className={`aha-library-row${checked ? " aha-library-row--checked" : ""}`}>
        <input type="checkbox" checked={checked} onChange={() => toggleTemplate(item.id)} />
        <span>
          <span className="aha-library-name">{item.name}</span>
          <span className="aha-library-sub muted">
            {ahaScopeLabel(item.scope)} · {item.csi || "—"} · {countPhrase(steps, "step", "steps")}
          </span>
        </span>
      </label>
    );
  }

  const rows =
    scopeFilter === "all"
      ? SCOPE_ORDER.map((scope) => {
          const items = visible.filter((item) => item.scope === scope);
          if (!items.length) return null;
          return (
            <div key={scope} className="stack aha-library-scope-group">
              <p className="aha-library-scope">{ahaScopeLabel(scope)}</p>
              {items.map(renderRow)}
            </div>
          );
        })
      : visible.map(renderRow);

  const createLabel =
    selected.length === 0
      ? "Create AHA"
      : `Create AHA (${countPhrase(selected.length, "template", "templates")} · ${countPhrase(stepCount, "step", "steps")})`;

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="modal card aha-library-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="aha-library-modal-head">
          <h3 id={titleId}>{title}</h3>
        </div>
        <div className="aha-library-modal-body">
          <div className="aha-library-modal-pane stack">
            {mode === "create" && (
              <div className="stack aha-library-bundles">
                <p className="aha-library-scope">Start from a bundle</p>
                <div className="filter-chips" role="group" aria-label="Recommended AHA bundles">
                  {RECOMMENDED_BUNDLES.map((bundle) => (
                    <button
                      key={bundle.name}
                      type="button"
                      className="filter-chip"
                      onClick={() => applyBundle(bundle.name, bundle.slugs)}
                    >
                      {bundle.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input
              autoFocus
              value={query}
              placeholder="Search name or CSI"
              aria-label="Search templates"
              onChange={(event) => setQuery(event.target.value)}
            />
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
            {visible.length === 0 ? (
              <p className="muted">{needle ? "No templates match." : "No templates in this scope."}</p>
            ) : (
              <div className="stack aha-library-list">{rows}</div>
            )}
          </div>
          <div className="aha-library-modal-pane stack">
            {mode === "create" && (
              <>
                <label className="stack aha-library-field">
                  <span className="muted small">AHA name</span>
                  <input
                    value={displayedName}
                    placeholder="e.g. Painting"
                    aria-label="AHA name"
                    onChange={(event) => {
                      setNameTouched(true);
                      setCreateName(event.target.value);
                    }}
                  />
                </label>
                <label className="stack aha-library-field">
                  <span className="muted small">CSI</span>
                  <input
                    value={displayedCsi}
                    aria-label="CSI"
                    onChange={(event) => {
                      setCsiTouched(true);
                      setCreateCsi(event.target.value);
                    }}
                  />
                </label>
              </>
            )}
            {selected.length === 0 ? (
              <p className="muted">
                {mode === "create"
                  ? "Pick a bundle or check templates to preview the AHA."
                  : "Check templates to preview the steps."}
              </p>
            ) : (
              <>
                <p className="aha-library-summary">{summary}</p>
                <div className="stack aha-library-preview">
                  {selected.map((template, index) => {
                    const open = !collapsedIds.has(template.id);
                    const steps = template.steps;
                    return (
                      <section key={template.id} className="aha-preview-group">
                        <div className="aha-preview-head">
                          <button
                            type="button"
                            className="aha-preview-toggle"
                            aria-expanded={open}
                            onClick={() => toggleCollapsed(template.id)}
                          >
                            <span
                              className={`wc-tracker-row-chevron aha-step-chevron${open ? " wc-tracker-row-chevron--open" : ""}`}
                              aria-hidden="true"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M9 6l6 6-6 6" />
                              </svg>
                            </span>
                            <span className="aha-library-name">{template.name}</span>
                            <span className="muted small">{countPhrase(steps.length, "step", "steps")}</span>
                          </button>
                          <div className="aha-preview-moves">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`Move ${template.name} up`}
                              disabled={index === 0}
                              onClick={() => moveGroup(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`Move ${template.name} down`}
                              disabled={index === selected.length - 1}
                              onClick={() => moveGroup(index, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                        {open && (
                          <ul className="aha-preview-steps">
                            {steps.map((step, stepIndex) => {
                              const name = step.name.trim() || "Untitled step";
                              if (mode === "create") {
                                return <li key={`${template.id}-${stepIndex}`}>{name}</li>;
                              }
                              return (
                                <li key={`${template.id}-${stepIndex}`}>
                                  <label className="aha-preview-step">
                                    <input
                                      type="checkbox"
                                      checked={stepOn(template.id, stepIndex)}
                                      onChange={() => toggleStep(template.id, stepIndex)}
                                    />
                                    <span>{name}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="aha-library-modal-footer">
          {error && <p className="banner banner-error aha-library-modal-error">{error}</p>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || selected.length === 0 || (mode === "add" && stepCount === 0)}
            onClick={submit}
          >
            {busy
              ? mode === "add"
                ? "Adding…"
                : "Creating…"
              : mode === "add"
                ? `Add ${countPhrase(stepCount, "step", "steps")}`
                : createLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
