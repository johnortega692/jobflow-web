import { useState, type KeyboardEvent } from "react";

type Props = {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
};

export function AhaChipList({ title, items, onChange, disabled }: Props) {
  const [draft, setDraft] = useState("");

  function add() {
    const next = draft.trim();
    if (!next) return;
    onChange([...items, next]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  }

  return (
    <section className="card stack aha-chip-card">
      <h3>{title}</h3>
      <div className="paint-spec-sections-chips" role="list" aria-label={title}>
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
      <input
        value={draft}
        disabled={disabled}
        placeholder="Add and press Enter"
        aria-label={`Add to ${title}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </section>
  );
}
