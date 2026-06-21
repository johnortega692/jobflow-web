import { useCallback, useLayoutEffect, useRef } from "react";

/** Track edits vs last loaded/saved snapshot for settings tabs. */
export function useSettingsDirtyTracker<T>(
  data: T,
  ready: boolean,
  onDirtyChange?: (dirty: boolean) => void,
) {
  const baselineRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  if (!ready) {
    baselineRef.current = null;
    isDirtyRef.current = false;
  } else if (baselineRef.current === null) {
    baselineRef.current = JSON.stringify(data);
    isDirtyRef.current = false;
  } else {
    isDirtyRef.current = JSON.stringify(data) !== baselineRef.current;
  }

  useLayoutEffect(() => {
    if (!ready) {
      onDirtyChangeRef.current?.(false);
      return;
    }
    onDirtyChangeRef.current?.(isDirtyRef.current);
  }, [ready, isDirtyRef.current, data]);

  const markSaved = useCallback(() => {
    baselineRef.current = JSON.stringify(data);
    isDirtyRef.current = false;
    onDirtyChangeRef.current?.(false);
  }, [data]);

  const readBaseline = useCallback((): T | null => {
    if (baselineRef.current === null) return null;
    return JSON.parse(baselineRef.current) as T;
  }, []);

  const getIsDirty = useCallback(() => isDirtyRef.current, []);

  return { markSaved, readBaseline, getIsDirty, isDirty: isDirtyRef.current };
}
