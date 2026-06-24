import { isSubmittalRevision } from "../../lib/printCore";

type Props = {
  revisionNumber: number;
  value: string;
  onChange: (value: string) => void;
};

export function RevisionNoteField({ revisionNumber, value, onChange }: Props) {
  if (!isSubmittalRevision(revisionNumber)) return null;

  return (
    <label className="stack revision-note-field">
      <span>
        Revision Note{" "}
        <span className="muted small">(optional — explains why this revision was created)</span>
      </span>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Updated color selections per design team review dated 06/18/2026."
      />
    </label>
  );
}
