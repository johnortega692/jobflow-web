import { useEffect, useMemo, useState } from "react";
import { ContractListFilter, type ContractListFilterValue } from "../jobinfo/ContractListFilter";
import {
  formatTransmittalHistoryDetail,
  formatTransmittalHistoryLabel,
} from "../../lib/transmittalSendHistory";
import { hasTransmittalContractSwitch } from "../../lib/jobInfo";
import { normalizeTransmittal, type TransmittalHistoryEntry } from "../../types/tradeDocuments";
import type { ProjectForm } from "../../types/database";

type Props = {
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">;
  history: TransmittalHistoryEntry[];
  onLoadSnapshot: (entry: TransmittalHistoryEntry) => void;
  onClose: () => void;
};

export function TransmittalSentHistoryModal({ project, history, onLoadSnapshot, onClose }: Props) {
  const showContract = hasTransmittalContractSwitch(project);
  const [contractFilter, setContractFilter] = useState<ContractListFilterValue>("all");
  const filteredHistory = useMemo(() => {
    if (contractFilter === "all") return history;
    return history.filter((entry) => (entry.contract ?? "paint") === contractFilter);
  }, [contractFilter, history]);

  const [selectedId, setSelectedId] = useState(filteredHistory[0]?.id ?? "");

  useEffect(() => {
    setSelectedId(filteredHistory[0]?.id ?? "");
  }, [filteredHistory]);

  const selected = filteredHistory.find((h) => h.id === selectedId);

  function onLoad() {
    if (!selected) return;
    if (
      !window.confirm(
        `Load transmittal ${selected.transmittal_number} into the current draft? Unsaved changes will be replaced.`,
      )
    ) {
      return;
    }
    onLoadSnapshot(selected);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack transmittal-sent-history-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Transmittal history</h3>
        <p className="muted small">
          Past transmittals downloaded from this project. Select one to review details or reload into the draft.
        </p>

        <ContractListFilter project={project} value={contractFilter} onChange={setContractFilter} />

        {!history.length ? (
          <p className="muted">No transmittals generated yet.</p>
        ) : filteredHistory.length === 0 ? (
          <p className="muted">No transmittals for this contract yet.</p>
        ) : (
          <div className="transmittal-sent-history-body">
            <ul className="transmittal-sent-history-list" role="listbox">
              {filteredHistory.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={entry.id === selectedId}
                    className={`transmittal-sent-history-item${entry.id === selectedId ? " selected" : ""}`}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    {formatTransmittalHistoryLabel(entry, { showContract: showContract })}
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="transmittal-sent-history-detail muted small">
                <pre className="transmittal-sent-history-pre">
                  {formatTransmittalHistoryDetail(selected, { showContract: showContract })}
                </pre>
                <p>
                  <strong>Remarks:</strong> {selected.snapshot.remarks.trim() || "—"}
                </p>
                <p>
                  <strong>To:</strong> {selected.snapshot.to_name.trim() || "—"}
                  {selected.snapshot.gc_name.trim() ? ` · ${selected.snapshot.gc_name.trim()}` : ""}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected}
            onClick={onLoad}
          >
            Load into draft
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function transmittalFromHistoryEntry(entry: TransmittalHistoryEntry) {
  return normalizeTransmittal(entry.snapshot);
}
