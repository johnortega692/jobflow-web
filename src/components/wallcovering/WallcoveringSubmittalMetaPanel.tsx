import { DateInput } from "../DateInput";
import { RevisionNoteField } from "../submittals/RevisionNoteField";
import { SpecSectionSelect } from "../submittals/SpecSectionSelect";
import { SubmittalIssueStatusPill } from "../submittals/SubmittalIssueStatusPill";
import { SubmittalPackageTypeSelect } from "../submittals/SubmittalPackageTypeSelect";
import {
  WALLCOVERING_SUBMITTAL_TYPES,
  type SubmittalIssueStatus,
  type SubmittalPackageCategory,
  type TradeSubmittalType,
  type WallcoveringSubmittalData,
} from "../../types/tradeDocuments";

type PackageOption = { id: SubmittalPackageCategory; label: string };

type Props = {
  draft: WallcoveringSubmittalData;
  draftLocked: boolean;
  packageTypeOptions: PackageOption[];
  onSubmittalNumberChange: (value: number) => void;
  onIssueStatusChange: (value: SubmittalIssueStatus) => void;
  onDateChange: (value: string) => void;
  onPackageTypeChange: (value: SubmittalPackageCategory) => void;
  onTypeChange: (value: TradeSubmittalType) => void;
  onSubjectChange: (value: string) => void;
  onSpecSectionChange: (value: string) => void;
  onRevisionNoteChange: (value: string) => void;
  onCreateNextRevision?: () => void;
};

function formatSubmittalIdentity(submittalNumber: number, revisionNumber: number): string {
  return `Submittal #${String(submittalNumber).padStart(3, "0")} · Rev ${revisionNumber}`;
}

export function WallcoveringSubmittalMetaPanel({
  draft,
  draftLocked,
  packageTypeOptions,
  onSubmittalNumberChange,
  onIssueStatusChange,
  onDateChange,
  onPackageTypeChange,
  onTypeChange,
  onSubjectChange,
  onSpecSectionChange,
  onRevisionNoteChange,
  onCreateNextRevision,
}: Props) {
  return (
    <section className="card stack paint-submittal-meta-card">
      <div className="paint-submittal-meta-strip">
        <div className="paint-submittal-meta-strip-main">
          {draftLocked ? (
            <p className="paint-submittal-meta-identity">
              {formatSubmittalIdentity(draft.submittal_number, draft.revision_number)}
            </p>
          ) : (
            <div className="paint-submittal-meta-identity paint-submittal-meta-identity--edit">
              <label className="paint-submittal-meta-num-label">
                <span className="sr-only">Submittal number</span>
                <span className="paint-submittal-meta-num-prefix">Submittal #</span>
                <input
                  type="number"
                  min={1}
                  className="paint-submittal-meta-num-input"
                  value={draft.submittal_number}
                  onChange={(e) => onSubmittalNumberChange(Number(e.target.value) || 1)}
                />
              </label>
              <span className="paint-submittal-meta-rev-label">· Rev {draft.revision_number}</span>
            </div>
          )}

          <SubmittalIssueStatusPill
            value={draft.issue_status}
            showLock={draftLocked}
            onChange={onIssueStatusChange}
          />

          <label className="paint-submittal-meta-date-wrap">
            <span className="sr-only">Date</span>
            <DateInput
              className="paint-submittal-meta-date"
              value={draft.date}
              onChange={onDateChange}
            />
          </label>
        </div>

        {draftLocked && onCreateNextRevision && (
          <button
            type="button"
            className="btn btn-secondary btn-small paint-submittal-meta-revision-btn"
            onClick={onCreateNextRevision}
          >
            <span className="paint-submittal-meta-revision-icon" aria-hidden="true">
              ⎇
            </span>
            Create next revision
          </button>
        )}
      </div>

      <div className="paint-submittal-meta-fields-row wc-submittal-meta-fields-row">
        <SubmittalPackageTypeSelect
          value={draft.package_type}
          options={packageTypeOptions}
          disabled={draftLocked}
          onChange={onPackageTypeChange}
        />
        <label>
          Type
          <select
            value={draft.submittal_type}
            onChange={(e) => onTypeChange(e.target.value as TradeSubmittalType)}
          >
            {WALLCOVERING_SUBMITTAL_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Spec section
          <SpecSectionSelect
            value={draft.spec_section}
            disabled={draftLocked}
            onChange={onSpecSectionChange}
          />
        </label>
        <label className="wc-submittal-meta-subject">
          Subject
          <input value={draft.subject} onChange={(e) => onSubjectChange(e.target.value)} />
        </label>
      </div>

      <RevisionNoteField
        revisionNumber={draft.revision_number}
        submittalType={draft.submittal_type}
        value={draft.revision_note ?? ""}
        onChange={onRevisionNoteChange}
      />
    </section>
  );
}
