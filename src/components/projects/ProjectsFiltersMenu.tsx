import { useEffect, useId, useRef, useState } from "react";
import {
  projectsListPanelFilterCount,
  resetProjectsListPanelFilters,
  toggleGcFilter,
  type ProjectsBrushoutFilter,
  type ProjectsListFilters,
  type ProjectsStartFilter,
} from "../../lib/projectListFilters";

type Props = {
  filters: ProjectsListFilters;
  gcOptions: { name: string; count: number }[];
  onChange: (next: ProjectsListFilters) => void;
};

const BRUSHOUTS: { id: ProjectsBrushoutFilter; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "added", label: "Added" },
  { id: "not_added", label: "Not added" },
];

const STARTS: { id: ProjectsStartFilter; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "started", label: "Already started" },
  { id: "next_30", label: "Next 30 days" },
  { id: "next_90", label: "Next 90 days" },
  { id: "beyond_90", label: "90+ days out" },
];

export function ProjectsFiltersMenu({ filters, gcOptions, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const activeCount = projectsListPanelFilterCount(filters);
  const selectedGcs = new Set(filters.gcs);
  const gcRows = [
    ...gcOptions,
    ...filters.gcs
      .filter((name) => !gcOptions.some((option) => option.name === name))
      .map((name) => ({ name, count: 0 })),
  ];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="projects-filters-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-secondary btn-sm projects-filters-trigger${open ? " projects-filters-trigger--open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Filters
        {activeCount > 0 && (
          <span className="projects-filters-badge" aria-label={`${activeCount} active filters`}>
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="projects-filters-panel"
          role="dialog"
          aria-label="Project filters"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <section className="projects-filters-section">
            <h3>General contractor</h3>
            {gcRows.length === 0 ? (
              <p className="muted small">No general contractors on these jobs.</p>
            ) : (
              <div className="projects-filters-checks">
                {gcRows.map((option) => (
                  <label key={option.name} className="projects-filter-check">
                    <input
                      type="checkbox"
                      checked={selectedGcs.has(option.name)}
                      onChange={() => onChange(toggleGcFilter(filters, option.name))}
                    />
                    <span className="projects-filter-check-name">{option.name}</span>
                    <span className="projects-filter-check-count">{option.count}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="projects-filters-section">
            <h3>Brush-outs</h3>
            <div className="projects-filter-segment" role="group" aria-label="Brush-outs">
              {BRUSHOUTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filters.brushouts === option.id}
                  onClick={() => onChange({ ...filters, brushouts: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="projects-filters-section">
            <h3>Job start</h3>
            <div className="projects-filter-segment" role="group" aria-label="Job start">
              {STARTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filters.start === option.id}
                  onClick={() => onChange({ ...filters, start: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="projects-filters-section">
            <h3>Other</h3>
            <label className="projects-filter-check">
              <input
                type="checkbox"
                checked={filters.flaggedOnly}
                onChange={() => onChange({ ...filters, flaggedOnly: !filters.flaggedOnly })}
              />
              <span>Flagged jobs only</span>
            </label>
            <label className="projects-filter-check">
              <input
                type="checkbox"
                checked={filters.includeClosed}
                onChange={() => onChange({ ...filters, includeClosed: !filters.includeClosed })}
              />
              <span>Include closed jobs</span>
            </label>
          </section>

          <div className="projects-filters-footer">
            <button
              type="button"
              className="projects-filters-reset"
              onClick={() => onChange(resetProjectsListPanelFilters(filters))}
            >
              Reset filters
            </button>
            <button type="button" className="projects-filters-done" onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
