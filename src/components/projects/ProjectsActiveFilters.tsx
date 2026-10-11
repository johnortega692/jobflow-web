import {
  projectsListActiveFilterPills,
  type ProjectsListFilters,
} from "../../lib/projectListFilters";

type Props = {
  shown: number;
  total: number;
  filters: ProjectsListFilters;
  onRemove: (key: string) => void;
  onClear: () => void;
};

export function ProjectsActiveFilters({ shown, total, filters, onRemove, onClear }: Props) {
  const pills = projectsListActiveFilterPills(filters);

  return (
    <div className="projects-active-filters">
      <span className="projects-active-filters-count">
        Showing {shown} of {total} jobs
      </span>
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
      {pills.length > 0 && (
        <button type="button" className="projects-filters-clear" onClick={onClear}>
          Clear all
        </button>
      )}
    </div>
  );
}
