import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./JobSearchCombo.css";

export type JobSearchProject = { id: string; jobNumber: string; jobName: string };

type Props = {
  projects: readonly JobSearchProject[];
  value: string;
  onChange: (projectId: string) => void;
  /** Called after a job is picked, e.g. to move focus to the note field. */
  onPicked?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
};

const MAX_MATCHES = 50;

export function jobSearchLabel(project: JobSearchProject): string {
  const name = project.jobName.trim() || "Untitled job";
  const number = project.jobNumber.trim();
  return number ? `${number} · ${name}` : name;
}

function matchesQuery(project: JobSearchProject, query: string): boolean {
  const haystack = `${project.jobNumber} ${project.jobName}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** Type a job number or name to filter; arrows + Enter or click to pick. */
export function JobSearchCombo({
  projects,
  value,
  onChange,
  onPicked,
  disabled,
  autoFocus,
  id,
  ariaLabel,
  placeholder = "Search job # or name…",
  className,
}: Props) {
  const selected = projects.find((project) => project.id === value);
  const [query, setQuery] = useState(selected ? jobSearchLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (selected) setQuery(jobSearchLabel(selected));
  }, [selected]);

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || (selected && jobSearchLabel(selected) === query)) return projects.slice(0, MAX_MATCHES);
    return projects.filter((project) => matchesQuery(project, trimmed)).slice(0, MAX_MATCHES);
  }, [projects, selected, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(project: JobSearchProject) {
    onChange(project.id);
    setQuery(jobSearchLabel(project));
    setOpen(false);
    onPicked?.();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((index) => Math.min(matches.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      const pick = open ? matches[activeIndex] : undefined;
      if (pick) {
        event.preventDefault();
        choose(pick);
      } else if (value) {
        event.preventDefault();
        onPicked?.();
      }
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className={["job-search-combo", className].filter(Boolean).join(" ")}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onFocus={(event) => {
          setOpen(true);
          if (selected) event.currentTarget.select();
        }}
        onBlur={() => {
          setOpen(false);
          if (selected) setQuery(jobSearchLabel(selected));
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          if (value) onChange("");
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Jobs" className="job-search-combo-list">
          {matches.length === 0 ? (
            <li className="job-search-combo-empty">No jobs match.</li>
          ) : (
            matches.map((project, index) => (
              <li
                key={project.id}
                id={`${listId}-opt-${index}`}
                role="option"
                data-index={index}
                aria-selected={project.id === value}
                className={`job-search-combo-option${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(project)}
              >
                <span className="job-search-combo-number">{project.jobNumber || "—"}</span>
                <span className="job-search-combo-name">{project.jobName || "Untitled job"}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
