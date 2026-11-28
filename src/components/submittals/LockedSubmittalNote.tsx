import { SUBMITTAL_ISSUE_STATUSES, type SubmittalIssueStatus } from "../../types/tradeDocuments";

type Props = {
  status: SubmittalIssueStatus;
  onCreateNextRevision?: () => void;
};

export function LockedSubmittalNote({ status, onCreateNextRevision }: Props) {
  const label = SUBMITTAL_ISSUE_STATUSES.find((item) => item.id === status)?.label ?? status.replace(/_/g, " ");
  return (
    <p className="paint-submittal-lock-note">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      <span>
        <strong>{label}</strong>
        {" · Items are locked. "}
        {onCreateNextRevision ? (
          <button type="button" className="paint-submittal-lock-note-link" onClick={onCreateNextRevision}>
            Create next revision
          </button>
        ) : (
          "Create next revision"
        )}
        {" to change them"}
      </span>
    </p>
  );
}
