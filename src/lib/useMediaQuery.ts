import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Field View calendar/workload compact layout (phone + iPad portrait). */
export const FIELD_COMPACT_MAX_WIDTH = 1024;

export function useFieldCompactLayout(mobileView: boolean): boolean {
  const narrow = useMediaQuery(`(max-width: ${FIELD_COMPACT_MAX_WIDTH}px)`);
  return mobileView || narrow;
}
