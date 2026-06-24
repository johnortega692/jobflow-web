import { SUBMITTAL_ISSUE_STATUSES, type SubmittalIssueStatus } from "../../types/tradeDocuments";

type Props = {
  value: SubmittalIssueStatus;
  onChange: (value: SubmittalIssueStatus) => void;
  disabled?: boolean;
};

export function SubmittalIssueStatusSelect({ value, onChange, disabled }: Props) {
  return (
    <label>
      Issue status
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SubmittalIssueStatus)}
      >
        {SUBMITTAL_ISSUE_STATUSES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
