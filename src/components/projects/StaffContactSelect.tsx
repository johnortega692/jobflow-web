import { staffContactLabel } from "../../lib/projectStaffSettings";
import type { StaffContact } from "../../types/staffContacts";

type Props = {
  label: string;
  contacts: StaffContact[];
  value: string;
  onChange: (id: string) => void;
  emptyHint?: string;
};

export function StaffContactSelect({ label, contacts, value, onChange, emptyHint }: Props) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Optional —</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {staffContactLabel(c)}
          </option>
        ))}
      </select>
      {!contacts.length && emptyHint ? <span className="muted small">{emptyHint}</span> : null}
    </label>
  );
}
