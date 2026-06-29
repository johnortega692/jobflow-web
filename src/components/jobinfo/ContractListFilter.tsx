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
    <div className="row-gap wrap contract-list-filter">
      <span className="muted small">{label}</span>
      <button
        type="button"
        className={`btn btn-sm${value === "all" ? " btn-secondary" : " btn-ghost"}`}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {contracts.map((contract) => (
        <button
          key={contract}
          type="button"
          className={`btn btn-sm${value === contract ? " btn-secondary" : " btn-ghost"}`}
          onClick={() => onChange(contract)}
        >
          {TRANSMITTAL_CONTRACT_LABELS[contract]}
        </button>
      ))}
    </div>
  );
}
