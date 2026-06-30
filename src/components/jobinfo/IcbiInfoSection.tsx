import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { useAuth } from "../../contexts/AuthContext";
import { buildIcbiPmOptions, shouldDefaultPmFromProfile } from "../../lib/icbiPmDefaults";
import { loadFieldToolsStaffForJobflow } from "../../lib/fieldToolsStaff";
import { jobInfoPatchFromStaffSelection, loadProjectStaffSettings } from "../../lib/projectStaffSettings";
import type { StaffContact } from "../../types/staffContacts";
import type { JobInfoData } from "../../types/jobInfo";

type Props = {
  jobInfo: JobInfoData;
  onChange: (patch: Partial<JobInfoData>) => void;
};

/** ICBI staff — single source for Field Tools field orders and Manpower sync. */
export function IcbiInfoSection({ jobInfo, onChange }: Props) {
  const { profile } = useLetterhead();
  const { jobRole } = useAuth();
  const [pmRoster, setPmRoster] = useState<StaffContact[]>([]);
  const [supers, setSupers] = useState<StaffContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seededPmRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([loadFieldToolsStaffForJobflow(), loadProjectStaffSettings()])
      .then(([fieldStaff, officeStaff]) => {
        if (cancelled) return;
        setSupers(fieldStaff.lists.supers);
        setPmRoster(officeStaff.project_staff_pms);
        if (fieldStaff.error) setError(fieldStaff.error);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load staff lists.");
        setPmRoster([]);
        setSupers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pmOptions = useMemo(() => buildIcbiPmOptions(profile, pmRoster, jobRole), [profile, pmRoster, jobRole]);
  const profileIsPm = shouldDefaultPmFromProfile(profile, pmRoster, jobRole);

  useEffect(() => {
    if (seededPmRef.current || jobInfo.icbi_pm.trim()) return;
    if (!profileIsPm || !profile.name.trim()) return;
    const match = pmOptions.find((o) => o.key === "profile") ?? pmOptions[0];
    if (!match) return;
    seededPmRef.current = true;
    onChange({ icbi_pm: match.name, icbi_pm_email: match.email });
  }, [jobInfo.icbi_pm, onChange, pmOptions, profile.name, profileIsPm]);

  const j = jobInfo;
  const superValue = j.field_request_super;
  const pmInOptions = pmOptions.some((o) => o.name === j.icbi_pm.trim());

  function onPmSelect(name: string) {
    const hit = pmOptions.find((o) => o.name === name);
    onChange({
      icbi_pm: name,
      icbi_pm_email: hit?.email ?? j.icbi_pm_email,
    });
  }

  function onSuperSelect(name: string) {
    const hit = supers.find((c) => c.name === name);
    onChange(
      hit
        ? jobInfoPatchFromStaffSelection(hit, undefined)
        : { field_request_super: name, staff_super_id: "", icbi_super_email: "" },
    );
  }

  return (
    <details className="job-section card stack" open>
      <summary className="job-section-summary">
        <h3>ICBI Info</h3>
      </summary>
      <p className="muted small">
        PM and super here feed{" "}
        <Link to="/field" target="_blank" rel="noopener noreferrer">
          Field Tools
        </Link>{" "}
        material orders and Manpower.
        {profileIsPm ? (
          <>
            {" "}
            PM defaults to your profile ({profile.name.trim() || "Settings → Your profile"}) — pick another from
            the list if needed.
          </>
        ) : (
          <>
            {" "}
            PM names from{" "}
            <Link to="/settings" state={{ tab: "project-staff" }}>Settings → Project staff</Link>.
          </>
        )}{" "}
        Supers from Field Tools. GC contacts stay in GC Info above.
      </p>
      {loading && <p className="muted small">Loading PM / super lists…</p>}
      {error && <p className="banner banner-warn">{error}</p>}
      <div className="grid-2">
        <label>
          Estimator
          <input value={j.icbi_estimator} onChange={(e) => onChange({ icbi_estimator: e.target.value })} />
        </label>
        <label>
          PM
          {pmOptions.length > 0 ? (
            <select value={j.icbi_pm} onChange={(e) => onPmSelect(e.target.value)}>
              <option value="">Select PM…</option>
              {pmOptions.map((o) => (
                <option key={o.key} value={o.name}>
                  {o.label}
                </option>
              ))}
              {j.icbi_pm.trim() && !pmInOptions && (
                <option value={j.icbi_pm}>{j.icbi_pm} (current)</option>
              )}
            </select>
          ) : (
            <input
              value={j.icbi_pm}
              placeholder={profileIsPm ? profile.name.trim() || "Ironwood PM" : "Ironwood PM"}
              onChange={(e) => onChange({ icbi_pm: e.target.value })}
            />
          )}
        </label>
        <label>
          PM email
          <input
            type="email"
            value={j.icbi_pm_email}
            placeholder="CC on Field Tools orders"
            onChange={(e) => onChange({ icbi_pm_email: e.target.value })}
          />
        </label>
        <label>
          PE
          <input value={j.icbi_engineer} onChange={(e) => onChange({ icbi_engineer: e.target.value })} />
        </label>
        <label>
          Foreman
          <input value={j.icbi_foreman} onChange={(e) => onChange({ icbi_foreman: e.target.value })} />
        </label>
        <label>
          Foreman email
          <input
            type="email"
            value={j.icbi_foreman_email}
            placeholder="CC on paint tracker & vendor emails"
            onChange={(e) => onChange({ icbi_foreman_email: e.target.value })}
          />
        </label>
        <label>
          Super
          {supers.length > 0 ? (
            <select
              value={superValue}
              onChange={(e) => onSuperSelect(e.target.value)}
            >
              <option value="">Select super…</option>
              {supers.map((contact) => (
                <option key={contact.id} value={contact.name}>
                  {contact.name}
                </option>
              ))}
              {superValue && !supers.some((c) => c.name === superValue) && (
                <option value={superValue}>{superValue} (not in Field Tools)</option>
              )}
            </select>
          ) : (
            <input
              value={j.field_request_super}
              placeholder="Super from Field Tools"
              onChange={(e) => onChange({ field_request_super: e.target.value })}
            />
          )}
        </label>
        <label>
          Super email
          <input
            type="email"
            value={j.icbi_super_email}
            onChange={(e) => onChange({ icbi_super_email: e.target.value })}
          />
        </label>
      </div>
    </details>
  );
}
