import { useEffect, useId, useRef, useState } from "react";
import { SUBMITTAL_ISSUE_STATUSES, type SubmittalIssueStatus } from "../../types/tradeDocuments";

type Props = {
  value: SubmittalIssueStatus;
  showLock?: boolean;
  onChange: (value: SubmittalIssueStatus) => void;
};

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 7V5a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm2 0h2V5a1 1 0 0 0-2 0v2z"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" className="submittal-status-chevron">
      <path fill="currentColor" d="M1 1l4 4 4-4" />
    </svg>
  );
}

export function SubmittalIssueStatusPill({ value, showLock = false, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = SUBMITTAL_ISSUE_STATUSES.find((s) => s.id === value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: SubmittalIssueStatus) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={`submittal-status-pill submittal-status-pill--${value}${open ? " submittal-status-pill--open" : ""}`}
    >
      <button
        type="button"
        className="submittal-status-badge"
        aria-label="Issue status"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        {showLock && (
          <span className="submittal-status-lock">
            <LockIcon />
          </span>
        )}
        <span className="submittal-status-label">{current?.label ?? value}</span>
        <ChevronIcon />
      </button>

      {open && (
        <ul id={listId} className="submittal-status-menu" role="listbox" aria-label="Issue status">
          {SUBMITTAL_ISSUE_STATUSES.map((s) => (
            <li key={s.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={s.id === value}
                className={`submittal-status-menu-item submittal-status-menu-item--${s.id}${s.id === value ? " submittal-status-menu-item--selected" : ""}`}
                onClick={() => pick(s.id)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
