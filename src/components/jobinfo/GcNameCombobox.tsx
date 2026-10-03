/**
 * Saved GC source and fill behavior, inspected before this control was added:
 *
 * Source: JobInfoSetupDrawer loads `loadContactDirectory(userId)` while the
 * drawer is open. That reads merged org/user settings (`loadRawUserSettings`
 * in contactDirectory.ts) and keeps `general_contractors` in `gcDirectory`.
 * Each saved GC is a `GcEntry`: `{ name, address, office_phone }` only
 * (types/contactDirectory.ts). Blank names are dropped by normalize/dedupe.
 *
 * Choosing a name calls the existing `applyGcFromDirectory` handler.
 * `lookupGeneralContractor` matches the name case-insensitively. On a hit it
 * sets `project.contractor` to `hit.name`, `jobInfo.gc_address` to
 * `hit.address`, and `jobInfo.gc_office_phone` to `hit.office_phone` only
 * when that phone is non-empty. It does not change fax, GC job #, or people
 * fields. A miss only sets `contractor`.
 *
 * No function adds one GC from the current company fields. `saveContactDirectory`
 * writes the whole directory. `mergeGeneralContractors` only merges an imported
 * list on the settings screen. That screen appends `emptyGcEntry()` into local
 * state. The "+ Save as a saved GC" row is omitted.
 *
 * `GcEntry` has no last-used or updated timestamp, so an empty query is A–Z
 * only (no Recent group). `projects.contractor` and `projects.updated_at`
 * exist, but that is not a timestamp on the saved GC and is not queried here.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { GcEntry } from "../../types/contactDirectory";

type Props = {
  id: string;
  value: string;
  directory: GcEntry[];
  className?: string;
  flash?: boolean;
  filledNotice: boolean;
  onValueChange: (name: string) => void;
  onPick: (name: string) => void;
  onUndo: () => void;
};

function streetSegment(address: string): string {
  const line = address.split(/\r?\n/, 1)[0] ?? "";
  return line.split(",")[0]?.trim() ?? "";
}

function optionMeta(entry: GcEntry): string {
  const phone = entry.office_phone.trim();
  const street = streetSegment(entry.address);
  return [phone, street].filter(Boolean).join(" · ");
}

function highlightName(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const at = name.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <span className="job-info-gc-match">{name.slice(at, at + q.length)}</span>
      {name.slice(at + q.length)}
    </>
  );
}

export function GcNameCombobox({
  id,
  value,
  directory,
  className,
  flash = false,
  filledNotice,
  onValueChange,
  onPick,
  onUndo,
}: Props) {
  const listId = useId();
  const noticeId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const skipFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const saved = useMemo(
    () => directory.filter((entry) => entry.name.trim()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [directory],
  );
  const query = value.trim().toLowerCase();
  const options = useMemo(
    () => (query ? saved.filter((entry) => entry.name.toLowerCase().includes(query)) : saved),
    [saved, query],
  );
  const exact = saved.some((entry) => entry.name.trim().toLowerCase() === query && query !== "");

  useEffect(() => {
    setActiveIndex(options.length === 0 ? -1 : 0);
  }, [options]);

  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    const place = () => {
      const rect = input.getBoundingClientRect();
      const panel = input.closest(".job-info-drawer-panel")?.getBoundingClientRect();
      const panelTop = panel?.top ?? 0;
      const panelBottom = panel?.bottom ?? window.innerHeight;
      const spaceBelow = panelBottom - rect.bottom - 6;
      const spaceAbove = rect.top - panelTop - 6;
      const below = spaceBelow >= 120 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(280, Math.max(48, below ? spaceBelow : spaceAbove));
      const top = below ? rect.bottom + 2 : Math.max(panelTop + 4, rect.top - 2 - maxHeight);
      setBox({ top, left: rect.left, width: rect.width, maxHeight });
    };
    place();
    const scroller = input.closest(".job-info-drawer-body");
    scroller?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      scroller?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, value, exact, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, box]);

  function openAtMatch() {
    const exactIndex = options.findIndex((entry) => entry.name.trim().toLowerCase() === query);
    setActiveIndex(exactIndex >= 0 ? exactIndex : options.length > 0 ? 0 : -1);
    setOpen(true);
  }

  function choose(entry: GcEntry) {
    onPick(entry.name);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openAtMatch();
        return;
      }
      setActiveIndex((index) => (options.length === 0 ? -1 : Math.min(index < 0 ? 0 : index + 1, options.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openAtMatch();
        return;
      }
      setActiveIndex((index) => (options.length === 0 ? -1 : Math.max((index < 0 ? 0 : index) - 1, 0)));
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const entry = options[activeIndex];
      if (entry) choose(entry);
    }
  }

  const list =
    open && box
      ? createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Saved GCs"
            className="job-info-gc-list"
            style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          >
            {options.length === 0 ? (
              <p className="job-info-gc-empty">No saved GC matches.</p>
            ) : (
              options.map((entry, index) => {
                const meta = optionMeta(entry);
                return (
                  <div
                    key={`${entry.name}-${index}`}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-index={index}
                    className={`job-info-gc-option${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(entry)}
                  >
                    <span className="job-info-gc-option-name">{highlightName(entry.name, value)}</span>
                    {meta ? <span className="job-info-gc-option-meta">{meta}</span> : null}
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={rootRef} className={`job-info-gc-combo${exact ? " has-saved" : ""}`}>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          className={[className, flash ? "job-info-gc-flash" : ""].filter(Boolean).join(" ") || undefined}
          value={value}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
          aria-describedby={filledNotice ? noticeId : undefined}
          autoComplete="off"
          onFocus={() => {
            if (skipFocusOpen.current) {
              skipFocusOpen.current = false;
              return;
            }
            openAtMatch();
          }}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {exact ? (
          <span className="job-info-gc-saved" aria-hidden="true">
            Saved
          </span>
        ) : null}
        <button
          type="button"
          className="job-info-gc-toggle"
          tabIndex={-1}
          aria-label="Show saved GCs"
          onMouseDown={(event) => {
            event.preventDefault();
            const input = inputRef.current;
            if (open) {
              if (input && document.activeElement !== input) skipFocusOpen.current = true;
              setOpen(false);
            } else {
              openAtMatch();
            }
            input?.focus();
          }}
        >
          ▾
        </button>
      </div>
      {filledNotice ? (
        <p id={noticeId} className="job-info-gc-filled" aria-live="polite">
          <span>Filled company fields from saved GC.</span>
          <button type="button" className="job-info-text-link" onClick={onUndo}>
            Undo
          </button>
        </p>
      ) : null}
      {list}
    </>
  );
}
