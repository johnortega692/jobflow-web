import {
  availableTransmittalContracts,
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
  TRANSMITTAL_CONTRACT_LABELS,
  type TransmittalContract,
} from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";
import { SegmentedControl } from "../SegmentedControl";

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
      <SegmentedControl
        className="transmittal-contract-tabs"
        aria-label="Contract"
        options={contracts.map((contract) => ({
          value: contract,
          label: TRANSMITTAL_CONTRACT_LABELS[contract],
        }))}
        value={value}
        onChange={onChange}
      />
      {showJobLabel && (
        <span className="muted small">
          {job.job_number}
          {job.job_name ? ` · ${job.job_name}` : ""}
        </span>
      )}
    </div>
  );
}
