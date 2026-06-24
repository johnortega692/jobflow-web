import { useCallback, useRef } from "react";

/** Track draft edits vs last loaded or saved snapshot. */
export function useTradeDraftDirty<T>(state: T, ready: boolean) {
  const baselineRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  if (!ready) {
    baselineRef.current = null;
    isDirtyRef.current = false;
  } else if (baselineRef.current === null) {
    baselineRef.current = JSON.stringify(state);
    isDirtyRef.current = false;
  } else {
    isDirtyRef.current = JSON.stringify(state) !== baselineRef.current;
  }

  const syncBaseline = useCallback((snapshot: T) => {
    baselineRef.current = JSON.stringify(snapshot);
    isDirtyRef.current = false;
  }, []);

  const markSaved = useCallback(() => {
    baselineRef.current = JSON.stringify(state);
    isDirtyRef.current = false;
  }, [state]);

  const readBaseline = useCallback((): T | null => {
    if (baselineRef.current === null) return null;
    return JSON.parse(baselineRef.current) as T;
  }, []);

  return {
    isDirty: isDirtyRef.current,
    syncBaseline,
    markSaved,
    readBaseline,
  };
}
