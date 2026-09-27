import type { AhaEmergencyContact, AhaEmergencyInfo } from "../../lib/aha/emergency";

type Props = {
  info: AhaEmergencyInfo;
  projectAddress: string;
  disabled: boolean;
  onChange: (info: AhaEmergencyInfo) => void;
  onCommit: (info: AhaEmergencyInfo) => void;
};

export function AhaEmergencyCard({ info, projectAddress, disabled, onChange, onCommit }: Props) {
  const addressShown = info.site_address_override.trim() || projectAddress;

  function commit(next: AhaEmergencyInfo) {
    onChange(next);
    onCommit(next);
  }

  function patch(next: Partial<AhaEmergencyInfo>, save: boolean) {
    const updated = { ...info, ...next };
    onChange(updated);
    if (save) onCommit(updated);
  }

  function patchContact(index: number, next: Partial<AhaEmergencyContact>, save: boolean) {
    patch(
      {
        emergency_contacts: info.emergency_contacts.map((row, rowIndex) =>
          rowIndex === index ? { ...row, ...next } : row,
        ),
      },
      save,
    );
  }

  return (
    <section className="card stack rfi-editor-rail-card">
      <div>
        <h3>Emergency info</h3>
        <p className="muted small">Shared by all JHAs on this job</p>
      </div>
      <label className="aha-field">
        Site address
        <input
          value={addressShown}
          disabled={disabled}
          onChange={(event) => patch({ site_address_override: event.target.value }, false)}
          onBlur={(event) => {
            const value = event.target.value.trim();
            commit({ ...info, site_address_override: value && value !== projectAddress.trim() ? value : "" });
          }}
        />
      </label>
      <label className="aha-field">
        Nearest hospital
        <input
          value={info.nearest_hospital}
          disabled={disabled}
          onChange={(event) => patch({ nearest_hospital: event.target.value }, false)}
          onBlur={() => commit(info)}
        />
      </label>
      <label className="aha-field">
        Occupational clinic
        <input
          value={info.occupational_clinic}
          disabled={disabled}
          onChange={(event) => patch({ occupational_clinic: event.target.value }, false)}
          onBlur={() => commit(info)}
        />
      </label>
      <div className="stack">
        <span className="aha-field">Emergency contacts</span>
        {info.emergency_contacts.map((contact, index) => (
          <div key={index} className="aha-contact-row">
            <input
              value={contact.name}
              placeholder="Name"
              aria-label={`Contact ${index + 1} name`}
              disabled={disabled}
              onChange={(event) => patchContact(index, { name: event.target.value }, false)}
              onBlur={() => commit(info)}
            />
            <input
              value={contact.role}
              placeholder="Role"
              aria-label={`Contact ${index + 1} role`}
              disabled={disabled}
              onChange={(event) => patchContact(index, { role: event.target.value }, false)}
              onBlur={() => commit(info)}
            />
            <input
              value={contact.phone}
              placeholder="Phone"
              aria-label={`Contact ${index + 1} phone`}
              disabled={disabled}
              onChange={(event) => patchContact(index, { phone: event.target.value }, false)}
              onBlur={() => commit(info)}
            />
            <button
              type="button"
              className="aha-row-delete"
              aria-label={`Remove contact ${index + 1}`}
              disabled={disabled}
              onClick={() =>
                commit({
                  ...info,
                  emergency_contacts: info.emergency_contacts.filter((_, rowIndex) => rowIndex !== index),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() =>
            onChange({ ...info, emergency_contacts: [...info.emergency_contacts, { name: "", role: "", phone: "" }] })
          }
        >
          + Add contact
        </button>
      </div>
      <label className="aha-field">
        Muster point
        <input
          value={info.muster_point}
          disabled={disabled}
          onChange={(event) => patch({ muster_point: event.target.value }, false)}
          onBlur={() => commit(info)}
        />
      </label>
    </section>
  );
}
