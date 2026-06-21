import {
  availableTransmittalContracts,
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";

type Props = {
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">;
  value: TransmittalContract;
  onChange: (contract: TransmittalContract) => void;
  showJobLabel?: boolean;
};

export function TradeContractTabs({ project, value, onChange, showJobLabel = false }: Props) {
  if (!hasTransmittalContractSwitch(project)) return null;

  const contracts = availableTransmittalContracts(project);
  const job = transmittalPrintInfo(project, value);

  return (
    <div className="transmittal-contract-row">
      <span className="muted small transmittal-contract-label">Contract</span>
      <div className="job-tracker-tabs transmittal-contract-tabs" role="tablist">
        {contracts.map((contract) => (
          <button
            key={contract}
            type="button"
            role="tab"
            aria-selected={value === contract}
            className={`job-tracker-tab${value === contract ? " job-tracker-tab--active" : ""}`}
            onClick={() => onChange(contract)}
          >
            {TRANSMITTAL_CONTRACT_LABELS[contract]}
          </button>
        ))}
      </div>
      {showJobLabel && (
        <span className="muted small">
          {job.job_number}
          {job.job_name ? ` · ${job.job_name}` : ""}
        </span>
      )}
    </div>
  );
}
