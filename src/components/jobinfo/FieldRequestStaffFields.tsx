import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { loadFieldToolsStaffForJobflow } from "../../lib/fieldToolsStaff";
import { loadProjectStaffSettings, staffContactNames } from "../../lib/projectStaffSettings";
import type { JobInfoData } from "../../types/jobInfo";

type Props = {
  jobInfo: JobInfoData;
  onChange: (patch: Partial<JobInfoData>) => void;
};

export function FieldRequestStaffFields({ jobInfo, onChange }: Props) {
  const { profile } = useLetterhead();
  const [pms, setPms] = useState<string[]>([]);
  const [supers, setSupers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seededPmRef = useRef(false);

  const profileName = profile.name.trim();

  useEffect(() => {
    if (seededPmRef.current || jobInfo.field_request_pm.trim()) return;
    if (!profileName) return;
    seededPmRef.current = true;
    onChange({ field_request_pm: profileName });
  }, [jobInfo.field_request_pm, onChange, profileName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([loadFieldToolsStaffForJobflow(), loadProjectStaffSettings()])
      .then(([fieldStaff, officeStaff]) => {
        if (cancelled) return;
        setSupers(fieldStaff.lists.supers.map((c) => c.name));
        setPms(staffContactNames(officeStaff.project_staff_pms));
        if (fieldStaff.error) setError(fieldStaff.error);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load staff lists.");
        setPms([]);
        setSupers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pmSuggestions = [...new Set([profileName, ...pms].filter(Boolean))];
  const superValue = jobInfo.field_request_super;

  return (
    <JobSectionInner title="Field Request Order">
      <p className="muted small">
        PM defaults from your profile name (Settings → Your profile) — edit if needed. PM names come from{" "}
        <Link to="/settings" state={{ tab: "project-staff" }}>Settings → Project staff</Link>. Super names
        come from{" "}
        <Link to="/field" target="_blank" rel="noopener noreferrer">
          Field Tools
        </Link>
        . Field Tools and Manpower use these values with Supabase. For two supers use{" "}
        <code>Name, Name</code>.
      </p>
      {loading && <p className="muted small">Loading PM / Super lists…</p>}
      {error && <p className="banner banner-warn">{error}</p>}
      {!loading && !error && !supers.length ? (
        <p className="muted small">
          Add supers in{" "}
          <Link to="/field" target="_blank" rel="noopener noreferrer">
            Field Tools
          </Link>{" "}
          to populate the super dropdown.
        </p>
      ) : null}
      <div className="grid-2">
        <label>
          Field Request PM
          <input
            list="field-request-pm-options"
            value={jobInfo.field_request_pm}
            placeholder={profileName || "PM from Settings → Project staff"}
            onChange={(e) => onChange({ field_request_pm: e.target.value })}
          />
          {pmSuggestions.length > 0 && (
            <datalist id="field-request-pm-options">
              {pmSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </label>
        <label>
          Field Request Super
          {supers.length > 0 ? (
            <select
              value={superValue}
              onChange={(e) => onChange({ field_request_super: e.target.value })}
            >
              <option value="">Select super…</option>
              {supers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {superValue && !supers.includes(superValue) && (
                <option value={superValue}>{superValue} (not in Field Tools)</option>
              )}
            </select>
          ) : (
            <input
              value={jobInfo.field_request_super}
              placeholder="Super from Field Tools"
              onChange={(e) => onChange({ field_request_super: e.target.value })}
            />
          )}
        </label>
      </div>
    </JobSectionInner>
  );
}

function JobSectionInner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="job-section card stack" open>
      <summary className="job-section-summary">
        <h3>{title}</h3>
      </summary>
      {children}
    </details>
  );
}
