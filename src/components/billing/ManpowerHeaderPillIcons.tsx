const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "billing-manpower-header-pill-icon",
  "aria-hidden": true,
  focusable: false,
};

/** 11px pencil for week plan headers. */
export function ManpowerHeaderPencilIcon() {
  return (
    <svg width={11} height={11} {...iconProps}>
      <path d="M11.2 2.3 13.7 4.8 5.5 13H3v-2.5L11.2 2.3z" />
      <path d="M9.8 3.7 12.3 6.2" />
    </svg>
  );
}

/** 11px calculator for month cost-calculator headers. */
export function ManpowerHeaderCalculatorIcon() {
  return (
    <svg width={11} height={11} {...iconProps}>
      <rect x="3" y="2" width="10" height="12" rx="1.2" />
      <path d="M5 5h6" />
      <path d="M5 8h1.2" />
      <path d="M7.4 8h1.2" />
      <path d="M9.8 8h1.2" />
      <path d="M5 10.5h1.2" />
      <path d="M7.4 10.5h1.2" />
      <path d="M9.8 10.5h1.2" />
    </svg>
  );
}
