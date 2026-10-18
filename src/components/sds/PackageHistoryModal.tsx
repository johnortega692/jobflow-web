import type { SdsPacketData } from "../../types/tradeDocuments";

type Props = {
  history: SdsPacketData[];
  currentNumber: number;
  onOpen: (packet: SdsPacketData) => void;
  onDelete: (submittalNumber: number) => void;
  onClose: () => void;
};

function packageLabel(packet: SdsPacketData): string {
  const number = `Package #${String(packet.submittal_number).padStart(3, "0")}`;
  const count = packet.sections.length;
  const products = `${count} product${count === 1 ? "" : "s"}`;
  return [number, packet.packet_type, packet.date.trim(), products].filter(Boolean).join(" · ");
}

export function PackageHistoryModal({ history, currentNumber, onOpen, onDelete, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-history-modal"
        role="dialog"
        aria-labelledby="package-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="package-history-title">Package history</h3>
        {history.length === 0 ? (
          <p className="muted">
            No saved packages yet. Packet PDF keeps this package, and New package starts the next number.
          </p>
        ) : (
          <ul className="sds-package-history-list">
            {history.map((packet) => {
              const current = packet.submittal_number === currentNumber;
              return (
                <li key={packet.submittal_number} className="sds-package-history-row">
                  <div className="stack">
                    <strong>{packageLabel(packet)}</strong>
                    {current ? <span className="muted small">Open now</span> : null}
                  </div>
                  <div className="row-gap wrap">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={current}
                      onClick={() => onOpen(packet)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => onDelete(packet.submittal_number)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
