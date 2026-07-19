import {
  availableTransmittalContracts,
  hasTransmittalContractSwitch,
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";

export type ContractListFilterValue = TransmittalContract | "all";

type Props = {
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">;
  value: ContractListFilterValue;
  onChange: (value: ContractListFilterValue) => void;
  label?: string;
};

export function ContractListFilter({ project, value, onChange, label = "Show" }: Props) {
  if (!hasTransmittalContractSwitch(project)) return null;

  const contracts = availableTransmittalContracts(project);

  return (
    <div className="filter-chips contract-list-filter" role="group" aria-label={label}>
      <span className="muted small filter-chips-label">{label}</span>
      <button
        type="button"
        className={`filter-chip${value === "all" ? " filter-chip--active" : ""}`}
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {contracts.map((contract) => (
        <button
          key={contract}
          type="button"
          className={`filter-chip${value === contract ? " filter-chip--active" : ""}`}
          aria-pressed={value === contract}
          onClick={() => onChange(contract)}
        >
          {TRANSMITTAL_CONTRACT_LABELS[contract]}
        </button>
      ))}
    </div>
  );
}
