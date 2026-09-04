import { formatDateDisplay, isoDateToDisplay, toIsoDateValue } from "../lib/dateInputUtils";

type DateInputProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Calendar-plus control that stamps today's date. */
  todayButton?: boolean;
};

function CalendarPlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12.5 21h-6.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v5" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M4 11h16" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </svg>
  );
}

/** Native calendar picker; stores values as MM/DD/YYYY (or keeps unparseable text). */
export function DateInput({
  value,
  onChange,
  id,
  className,
  disabled,
  placeholder,
  todayButton = false,
}: DateInputProps) {
  const iso = toIsoDateValue(value);
  const input = (
    <input
      id={id}
      type="date"
      className={className ?? "date-input"}
      disabled={disabled}
      title={value || placeholder || "Pick a date"}
      value={iso}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next ? isoDateToDisplay(next) : "");
      }}
    />
  );

  if (!todayButton) return input;

  return (
    <div className="date-input-row">
      {input}
      <button
        type="button"
        className="date-today-btn"
        disabled={disabled}
        title="Set to today"
        aria-label="Set to today"
        onClick={() => onChange(formatDateDisplay(new Date()))}
      >
        <CalendarPlusIcon />
      </button>
    </div>
  );
}
