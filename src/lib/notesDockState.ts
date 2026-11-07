export type NotesDockMode = "min" | "std" | "wide";
export type NotesDockOpenMode = Exclude<NotesDockMode, "min">;

export type NotesDockState = {
  mode: NotesDockMode;
  last: NotesDockOpenMode;
  /** Open width in px; drag-resizing sets it anywhere in the clamp range. */
  width: number;
};

export const NOTES_DOCK_MIN_WIDTH = 46;
export const NOTES_DOCK_STD_WIDTH = 340;
export const NOTES_DOCK_WIDE_WIDTH = 600;
export const NOTES_DOCK_RESIZE_MIN = 300;
export const NOTES_DOCK_RESIZE_MAX = 760;
/** Widths at or above this count as "wide". */
export const NOTES_DOCK_WIDE_AT = 520;

const STORAGE_KEY = "jobflow.projects.notesDock.v1";
const TOGGLE_EVENT = "jobflow:notes-dock-toggle";

export function widthForMode(mode: NotesDockOpenMode): number {
  return mode === "wide" ? NOTES_DOCK_WIDE_WIDTH : NOTES_DOCK_STD_WIDTH;
}

export function modeForWidth(width: number): NotesDockOpenMode {
  return width >= NOTES_DOCK_WIDE_AT ? "wide" : "std";
}

export function clampDockWidth(width: number): number {
  return Math.min(NOTES_DOCK_RESIZE_MAX, Math.max(NOTES_DOCK_RESIZE_MIN, Math.round(width)));
}

const DEFAULT_STATE: NotesDockState = { mode: "std", last: "std", width: NOTES_DOCK_STD_WIDTH };

export function loadNotesDockState(): NotesDockState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<NotesDockState>;
    const last: NotesDockOpenMode = parsed.last === "wide" ? "wide" : "std";
    const mode: NotesDockMode = parsed.mode === "min" || parsed.mode === "wide" || parsed.mode === "std" ? parsed.mode : "std";
    const width =
      typeof parsed.width === "number" && Number.isFinite(parsed.width) ? clampDockWidth(parsed.width) : widthForMode(last);
    return { mode, last, width };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveNotesDockState(state: NotesDockState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the panel still works for this visit.
  }
}

/** The top-nav Notes link calls this while the Projects page is open. */
export function requestNotesDockToggle(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

export function subscribeNotesDockToggle(listener: () => void): () => void {
  window.addEventListener(TOGGLE_EVENT, listener);
  return () => window.removeEventListener(TOGGLE_EVENT, listener);
}
