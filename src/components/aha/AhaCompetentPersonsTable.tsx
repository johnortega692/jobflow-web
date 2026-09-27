import type { AhaCompetentPerson, AhaQualification } from "../../lib/aha/types";

const QUALIFICATIONS: { value: AhaQualification; label: string }[] = [
  { value: "competent", label: "Competent" },
  { value: "qualified", label: "Qualified" },
  { value: "trained", label: "Trained" },
  { value: "qualified_licensed", label: "Qualified-Licensed" },
];

type Props = {
  rows: AhaCompetentPerson[];
  disabled: boolean;
  onChange: (rows: AhaCompetentPerson[]) => void;
};

export function AhaCompetentPersonsTable({ rows, disabled, onChange }: Props) {
  function patch(id: string, partial: Partial<AhaCompetentPerson>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...partial } : row)));
  }

  return (
    <section className="card stack aha-table-card">
      <h3>Competent / qualified persons</h3>
      <div className="aha-table-scroll">
        <table className="aha-grid-table aha-persons-table">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Qualification</th>
              <th>N/A</th>
              <th>Employee name</th>
              <th>Note</th>
              <th className="aha-col-action" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className={row.na ? "aha-person-row--na" : undefined}>
                <td>
                  <input
                    value={row.activity}
                    disabled={disabled}
                    aria-label={`Activity ${index + 1}`}
                    onChange={(event) => patch(row.id, { activity: event.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="aha-select"
                    value={row.qualification}
                    disabled={disabled}
                    aria-label={`Qualification ${index + 1}`}
                    onChange={(event) => patch(row.id, { qualification: event.target.value as AhaQualification })}
                  >
                    {QUALIFICATIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <label className="check aha-na-check">
                    <input
                      type="checkbox"
                      checked={row.na}
                      disabled={disabled}
                      aria-label={`N/A for activity ${index + 1}`}
                      onChange={(event) => patch(row.id, { na: event.target.checked })}
                    />
                  </label>
                </td>
                <td>
                  <input
                    value={row.employee}
                    disabled={disabled || row.na}
                    aria-label={`Employee name ${index + 1}`}
                    onChange={(event) => patch(row.id, { employee: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="aha-note-input"
                    value={row.note}
                    disabled={disabled}
                    aria-label={`Note ${index + 1}`}
                    onChange={(event) => patch(row.id, { note: event.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="aha-row-delete"
                    aria-label={`Remove activity ${index + 1}`}
                    disabled={disabled}
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="aha-step-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...rows,
              {
                id: crypto.randomUUID(),
                activity: "",
                qualification: "competent",
                na: false,
                note: "",
                employee: "",
              },
            ])
          }
        >
          + Add activity
        </button>
      </div>
    </section>
  );
}
