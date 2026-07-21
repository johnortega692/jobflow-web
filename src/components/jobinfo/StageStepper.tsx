export type StageStepperItem = {
  key: string;
  label: string;
  state: "done" | "current" | "todo";
  title?: string;
};

type Props = {
  items: StageStepperItem[];
  ariaLabel: string;
  disabled?: boolean;
  onSelect: (key: string) => void;
};

type FlagSwitchProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** On-state track color: stage flags = ok, plain attributes = accent, attention = warn. */
  tone: "ok" | "accent" | "warn";
  disabled?: boolean;
};

/** Switch-style toggle for the stepper extras slot (occasional flags, not stages). */
export function FlagSwitch({ label, checked, onChange, tone, disabled }: FlagSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`flag-switch flag-switch--${tone}${checked ? " flag-switch--on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="flag-switch-track" aria-hidden>
        <span className="flag-switch-knob" />
      </span>
      <span className="flag-switch-label">{label}</span>
    </button>
  );
}

/** Numbered stage pills: done = green, current = accent, todo = muted. */
export function StageStepper({ items, ariaLabel, disabled, onSelect }: Props) {
  return (
    <div className="wc-stage-stepper" role="group" aria-label={ariaLabel}>
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          className={`wc-stage-step wc-stage-step--${item.state}`}
          aria-pressed={item.state === "current"}
          title={item.title ?? item.label}
          disabled={disabled}
          onClick={() => onSelect(item.key)}
        >
          <span className="wc-stage-step-num">{i + 1}</span>
          <span className="wc-stage-step-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
