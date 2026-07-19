import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import "./SegmentedControl.css";

export type SegmentedControlOption<T extends string = string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
};

type ThumbRect = {
  left: number;
  width: number;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [thumb, setThumb] = useState<ThumbRect>({ left: 0, width: 0 });

  const setBtnRef = useCallback((optionValue: T, node: HTMLButtonElement | null) => {
    if (node) btnRefs.current.set(optionValue, node);
    else btnRefs.current.delete(optionValue);
  }, []);

  const syncThumb = useCallback(() => {
    const root = rootRef.current;
    const active = btnRefs.current.get(value);
    if (!root || !active) {
      setThumb({ left: 0, width: 0 });
      return;
    }
    setThumb({
      left: active.offsetLeft,
      width: active.offsetWidth,
    });
  }, [value]);

  useLayoutEffect(() => {
    syncThumb();
  }, [syncThumb, options]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncThumb());
    ro.observe(root);
    for (const btn of btnRefs.current.values()) ro.observe(btn);
    return () => ro.disconnect();
  }, [syncThumb, options]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const index = options.findIndex((o) => o.value === value);
    if (index < 0) return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight"
        ? options[Math.min(index + 1, options.length - 1)]
        : options[Math.max(index - 1, 0)];
    if (next && next.value !== value) onChange(next.value);
  }

  const thumbStyle: CSSProperties = {
    transform: `translateX(${thumb.left}px)`,
    width: thumb.width || undefined,
  };

  return (
    <div
      ref={rootRef}
      className={["segmented-control", className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      <span
        className="segmented-control__thumb"
        style={thumbStyle}
        aria-hidden="true"
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => setBtnRef(option.value, node)}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`segmented-control__btn${selected ? " segmented-control__btn--active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
