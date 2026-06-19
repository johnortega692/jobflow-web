import { useEffect, useRef } from "react";

type Props = {
  matches: { display: string; vendor: string }[];
  onSelect: (display: string, vendor: string) => void;
  onClose: () => void;
};

export function ColorLookupModal({ matches, onSelect, onClose }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector("button")?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-color-lookup"
        role="dialog"
        aria-labelledby="color-lookup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="color-lookup-title">Select color</h3>
        <p className="muted small">
          {matches.length} match{matches.length === 1 ? "" : "es"} — click or press Enter
        </p>
        <ul ref={listRef} className="color-lookup-list">
          {matches.map((m) => (
            <li key={`${m.vendor}-${m.display}`}>
              <button
                type="button"
                className="color-lookup-item"
                onClick={() => onSelect(m.display, m.vendor)}
              >
                {m.display}
              </button>
            </li>
          ))}
        </ul>
        <div className="row-gap">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
