import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  PROJECTS_LIST_SORT_GROUPS,
  projectsListSortLabel,
  type ProjectsListSort,
  type ProjectsListSortDir,
} from "../../lib/projectListSummary";

type Props = {
  sort: ProjectsListSort;
  dir: ProjectsListSortDir;
  onSelect: (sort: ProjectsListSort) => void;
  onToggleDir: () => void;
};

export function ProjectsListSortControl({ sort, dir, onSelect, onToggleDir }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const label = projectsListSortLabel(sort);

  useEffect(() => {
    if (!open) return;
    const flat = PROJECTS_LIST_SORT_GROUPS.flatMap((group) => group.options);
    const activeIndex = Math.max(0, flat.findIndex((option) => option.id === sort));
    itemRefs.current[activeIndex]?.focus();

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
  }, [open, sort]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = itemRefs.current.filter((button): button is HTMLButtonElement => button != null);
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  let itemIndex = 0;

  return (
    <div className="projects-sort-split" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="projects-sort-split-main"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="projects-sort-split-kicker">Sort</span>
        <span>{label}</span>
        <svg className="projects-sort-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="projects-sort-split-dir"
        title="Reverse order"
        aria-label="Reverse order"
        onClick={onToggleDir}
      >
        {dir === "asc" ? "↑" : "↓"}
      </button>
      {open && (
        <div
          id={menuId}
          className="projects-sort-menu"
          role="menu"
          aria-label="Sort projects"
          onKeyDown={onMenuKeyDown}
        >
          {PROJECTS_LIST_SORT_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="projects-sort-menu-heading">{group.label}</div>
              {group.options.map((option) => {
                const index = itemIndex;
                itemIndex += 1;
                const active = option.id === sort;
                return (
                  <button
                    key={option.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`projects-sort-menu-item${active ? " projects-sort-menu-item--active" : ""}`}
                    onClick={() => {
                      onSelect(option.id);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    <span className="projects-sort-menu-check" aria-hidden="true">
                      {active ? "✓" : ""}
                    </span>
                    <span>{option.label}</span>
                    <span className="projects-sort-menu-hint">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
