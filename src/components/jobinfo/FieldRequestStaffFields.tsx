import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { fetchFieldRequestStaffLists, fieldRequestOrderUrl } from "../../lib/fieldRequestOrderSync";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";
import type { JobInfoData } from "../../types/jobInfo";

type Props = {
  jobInfo: JobInfoData;
  onChange: (patch: Partial<JobInfoData>) => void;
};

export function FieldRequestStaffFields({ jobInfo, onChange }: Props) {
  const { user } = useAuth();
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
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadPaintUserSettings(user.id).then(async (settings) => {
      const url = fieldRequestOrderUrl(settings.google_urls);
      const result = await fetchFieldRequestStaffLists(url);
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        setError(result.error);
        setPms([]);
        setSupers([]);
        return;
      }
      setPms(result.lists.pms);
      setSupers(result.lists.supers);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const pmSuggestions = [...new Set([profileName, ...pms].filter(Boolean))];
  const superValue = jobInfo.field_request_super;

  return (
    <JobSectionInner title="Field Request Order">
      <p className="muted small">
        PM defaults from your profile name (Settings → Your profile) — edit if needed. Names must
        match the Field Request spreadsheet exactly. For two supers use <code>Name, Name</code>.
      </p>
      {loading && <p className="muted small">Loading PM / Super lists…</p>}
      {error && (
        <p className="banner banner-warn">
          {error}{" "}
          <Link to="/settings">Configure Field Request URL</Link>
        </p>
      )}
      <div className="grid-2">
        <label>
          Field Request PM
          <input
            list="field-request-pm-options"
            value={jobInfo.field_request_pm}
            placeholder={profileName || "PM name from PMs sheet"}
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
                <option value={superValue}>{superValue} (not on sheet)</option>
              )}
            </select>
          ) : (
            <input
              value={jobInfo.field_request_super}
              placeholder="Must match Supers sheet"
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
