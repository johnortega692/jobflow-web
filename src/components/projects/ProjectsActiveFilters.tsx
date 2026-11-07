import {
  projectsListActiveFilterPills,
  type ProjectsListFilters,
} from "../../lib/projectListFilters";

type Props = {
  filters: ProjectsListFilters;
  onRemove: (key: string) => void;
  onClear: () => void;
};

export function ProjectsActiveFilters({ filters, onRemove, onClear }: Props) {
  const pills = projectsListActiveFilterPills(filters);
  if (!pills.length) return null;

  return (
    <div className="projects-active-filters">
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          className="projects-filter-pill"
          aria-label={`Remove ${pill.label}`}
          onClick={() => onRemove(pill.key)}
        >
          {pill.label}
          <span className="projects-filter-pill-x" aria-hidden="true">
            ×
          </span>
        </button>
      ))}
      <button type="button" className="projects-filters-clear" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}
