import type { SubmittalPackageCategory } from "../../types/tradeDocuments";

type Option = { id: SubmittalPackageCategory; label: string };

type Props = {
  label?: string;
  value: SubmittalPackageCategory;
  options: Option[];
  disabled?: boolean;
  onChange: (value: SubmittalPackageCategory) => void;
};

export function SubmittalPackageTypeSelect({
  label = "Package type",
  value,
  options,
  disabled,
  onChange,
}: Props) {
  return (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SubmittalPackageCategory)}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
