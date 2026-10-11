import {
  PROJECT_STATUS_CHIPS,
  type ProjectsListFilters,
  type ProjectsListStatusId,
} from "../../lib/projectListFilters";

type Props = {
  filters: ProjectsListFilters;
  counts: Record<ProjectsListStatusId, number>;
  total: number;
  onToggle: (id: ProjectsListStatusId) => void;
  onClear: () => void;
};

export function ProjectsStatusChips({ filters, counts, total, onToggle, onClear }: Props) {
  const allActive = filters.stages.length === 0;

  return (
    <div className="projects-status-chips" role="group" aria-label="Filter by submittal status">
      <button
        type="button"
        className={`projects-status-chip${allActive ? " projects-status-chip--active" : ""}`}
        aria-pressed={allActive}
        onClick={onClear}
      >
        All
        <span className="projects-status-chip-count">{total}</span>
      </button>
      {PROJECT_STATUS_CHIPS.map((chip) => {
        const selected = filters.stages.includes(chip.id);
        const count = counts[chip.id] ?? 0;
        const disabled = count === 0 && !selected;
        return (
          <button
            key={chip.id}
            type="button"
            className={`projects-status-chip${selected ? " projects-status-chip--active" : ""}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(chip.id)}
          >
            <span className={`projects-status-dot projects-status-dot--${chip.dot}`} aria-hidden="true" />
            {chip.label}
            <span className="projects-status-chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
