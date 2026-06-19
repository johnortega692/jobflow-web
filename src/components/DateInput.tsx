import { isoDateToDisplay, toIsoDateValue } from "../lib/dateInputUtils";

type DateInputProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
};

/** Native calendar picker; stores values as MM/DD/YYYY (or keeps unparseable text). */
export function DateInput({ value, onChange, id, className, disabled, placeholder }: DateInputProps) {
  const iso = toIsoDateValue(value);

  return (
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
}
