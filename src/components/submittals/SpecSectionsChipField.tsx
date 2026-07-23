import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  DEFAULT_PAINT_SECONDARY_SPEC_SECTION,
  DEFAULT_WC_SPEC_SECTION,
  loadSpecSections,
  withEnsuredSpecSection,
} from "../../lib/specSections";

type Props = {
  selected: string[];
  disabled?: boolean;
  maxSections: number;
  onAdd: (section: string) => void;
  onRemove: (index: number) => void;
};

export function SpecSectionsChipField({ selected, disabled, maxSections, onAdd, onRemove }: Props) {
  const { user } = useAuth();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const atCap = selected.length >= maxSections;

  useEffect(() => {
    let cancelled = false;
    void loadSpecSections(user?.id)
      .then((list) => {
        if (!cancelled) {
          let next = withEnsuredSpecSection(list, DEFAULT_PAINT_SECONDARY_SPEC_SECTION);
          next = withEnsuredSpecSection(next, DEFAULT_WC_SPEC_SECTION);
          setCatalog(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog([DEFAULT_WC_SPEC_SECTION, DEFAULT_PAINT_SECONDARY_SPEC_SECTION]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const available = catalog.filter((section) => !selected.includes(section));

  return (
    <div className="paint-spec-sections-field">
      <span className="paint-spec-sections-label" id={`${menuId}-label`}>
        Spec sections
      </span>
      <div
        ref={rootRef}
        className={`paint-spec-sections-control${menuOpen ? " paint-spec-sections-control--open" : ""}${
          disabled ? " paint-spec-sections-control--disabled" : ""
        }`}
        aria-labelledby={`${menuId}-label`}
      >
        <div className="paint-spec-sections-chips" role="list" aria-label="Selected spec sections">
          {selected.map((section, index) => {
            const isLead = index === 0;
            return (
              <span
                key={section}
                role="listitem"
                className={`paint-spec-chip${isLead ? " paint-spec-chip--lead" : ""}`}
              >
                {isLead ? <span className="paint-spec-chip-lead-tag">Lead</span> : null}
                <span className="paint-spec-chip-label">{section}</span>
                {!disabled && (
                  <button
                    type="button"
                    className="paint-spec-chip-remove"
                    aria-label={`Remove ${section}`}
                    onClick={() => onRemove(index)}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
          {!disabled && !atCap && (
            <button
              type="button"
              className="paint-spec-add-btn"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((open) => !open)}
            >
              + Add section
            </button>
          )}
          {!disabled && atCap ? <span className="paint-spec-cap-hint">Max {maxSections}</span> : null}
        </div>

        {menuOpen && !disabled && !atCap ? (
          <ul id={menuId} className="paint-spec-sections-menu" role="listbox" aria-label="Available spec sections">
            {available.length === 0 ? (
              <li className="paint-spec-sections-menu-empty" role="presentation">
                All sections added
              </li>
            ) : (
              available.map((section) => (
                <li key={section} role="option" aria-selected="false">
                  <button
                    type="button"
                    className="paint-spec-sections-menu-item"
                    onClick={() => {
                      onAdd(section);
                      setMenuOpen(false);
                    }}
                  >
                    {section}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
