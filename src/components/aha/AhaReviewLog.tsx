import { useState } from "react";
import type { AhaReviewEntry } from "../../lib/aha/types";

type Props = {
  entries: AhaReviewEntry[];
  profileName: string;
  disabled: boolean;
  onChange: (entries: AhaReviewEntry[]) => void;
};

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatReviewDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso.trim();
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function AhaReviewLog({ entries, profileName, disabled, onChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  function patch(id: string, partial: Partial<AhaReviewEntry>) {
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...partial } : entry)));
  }

  function add() {
    const entry: AhaReviewEntry = {
      id: crypto.randomUUID(),
      name: profileName,
      date: todayIso(),
      note: "",
    };
    onChange([entry, ...entries]);
    setOpenId(entry.id);
  }

  const reviewLabel = entries.length === 0 ? "Reviews: none yet" : entries.length === 1 ? "1 review" : `${entries.length} reviews`;

  return (
    <div className="aha-reviews">
      <div className="aha-review-row">
        <span>{reviewLabel}</span>
        <button type="button" className="aha-text-link" disabled={disabled} onClick={add}>
          + Add review
        </button>
      </div>
      <ul className="aha-review-list">
        {entries.map((entry) => (
          <li key={entry.id} className="aha-review-item">
            {openId === entry.id ? (
              <div className="aha-review-edit">
                <input
                  autoFocus
                  value={entry.name}
                  disabled={disabled}
                  aria-label="Reviewer name"
                  onChange={(event) => patch(entry.id, { name: event.target.value })}
                />
                <input
                  type="date"
                  value={entry.date}
                  disabled={disabled}
                  aria-label="Review date"
                  onChange={(event) => patch(entry.id, { date: event.target.value })}
                />
                <input
                  value={entry.note}
                  disabled={disabled}
                  aria-label="Review note"
                  placeholder="Note"
                  onChange={(event) => patch(entry.id, { note: event.target.value })}
                />
              </div>
            ) : (
              <button type="button" className="aha-review-line" disabled={disabled} onClick={() => setOpenId(entry.id)}>
                <span>{entry.name.trim() || "—"}</span>
                <span className="muted"> · </span>
                <span>{formatReviewDate(entry.date) || "—"}</span>
                <span className="muted"> · </span>
                <span>{entry.note.trim() || "—"}</span>
              </button>
            )}
            <button
              type="button"
              className="aha-row-delete"
              aria-label="Remove review"
              disabled={disabled}
              onClick={() => {
                onChange(entries.filter((item) => item.id !== entry.id));
                if (openId === entry.id) setOpenId(null);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
