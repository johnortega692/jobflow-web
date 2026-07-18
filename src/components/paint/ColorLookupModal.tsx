import { useEffect, useMemo, useRef, useState } from "react";
import { abbreviateVendorKey, type PaintColorMatch } from "../../lib/paintCatalog";

type Props = {
  query: string;
  matches: PaintColorMatch[];
  onSelect: (display: string, vendor: string, hex?: string) => void;
  onClose: () => void;
};

export function ColorLookupModal({ query, matches, onSelect, onClose }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState(query);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter(
      (m) =>
        m.display.toLowerCase().includes(q) ||
        m.vendor.toLowerCase().includes(q) ||
        abbreviateVendorKey(m.vendor).toLowerCase().includes(q),
    );
  }, [filter, matches]);

  useEffect(() => {
    setHighlight(0);
  }, [filter, matches]);

  useEffect(() => {
    filterRef.current?.focus();
    filterRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!filtered.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const m = filtered[highlight];
        if (m) onSelect(m.display, m.vendor, m.hex);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, highlight, onClose, onSelect]);

  useEffect(() => {
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

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
          {matches.length
            ? `${matches.length} match${matches.length === 1 ? "" : "es"} for “${query}” — pick the correct color.`
            : `No matches for “${query}”.`}
        </p>

        {matches.length > 0 && (
          <label className="color-lookup-filter">
            Filter
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Narrow results…"
            />
          </label>
        )}

        {filtered.length > 0 ? (
          <ul ref={listRef} className="color-lookup-list" role="listbox" aria-label="Color matches">
            {filtered.map((m, i) => (
              <li key={`${m.vendor}-${m.display}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`color-lookup-item${i === highlight ? " color-lookup-item-active" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => onSelect(m.display, m.vendor, m.hex)}
                >
                  <span className="color-lookup-item-label">{m.display}</span>
                  <span className="color-lookup-item-vendor">{abbreviateVendorKey(m.vendor)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : matches.length > 0 ? (
          <p className="muted small color-lookup-empty">No results match your filter.</p>
        ) : (
          <p className="muted small color-lookup-empty">
            No matches in <code>paint_colors.json</code> for that number or name. Try{" "}
            <code>SW7004</code>, <code>7004</code>, or part of the color name.
          </p>
        )}

        <div className="row-gap">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
