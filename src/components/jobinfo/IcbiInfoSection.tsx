import { useEffect, useMemo, useRef, useState } from "react";
import { EmailAddressWarning } from "../EmailAddressWarning";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { useAuth } from "../../contexts/AuthContext";
import { buildIcbiPmOptions, shouldDefaultPmFromProfile } from "../../lib/icbiPmDefaults";
import { loadFieldToolsStaffForJobflow } from "../../lib/fieldToolsStaff";
import { jobInfoPatchFromStaffSelection, loadProjectStaffSettings } from "../../lib/projectStaffSettings";
import type { StaffContact } from "../../types/staffContacts";
import type { JobInfoData } from "../../types/jobInfo";

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function inputClass(value: string): string | undefined {
  return isBlank(value) ? "job-info-input-empty" : undefined;
}

function fieldClass(filled: boolean, extra?: string): string {
  return [extra, "job-info-field", filled ? "is-filled" : ""].filter(Boolean).join(" ");
}

type Props = {
  jobInfo: JobInfoData;
  onChange: (patch: Partial<JobInfoData>) => void;
  /** Display-only filled/total for the section heading. */
  progress?: { filled: number; total: number };
};

/** ICBI staff — single source for Field Tools field orders and Manpower sync. */
export function IcbiInfoSection({ jobInfo, onChange, progress }: Props) {
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

  const complete = progress != null && progress.total > 0 && progress.filled === progress.total;
  const pmNameFilled = pmOptions.length > 0 || !isBlank(j.icbi_pm);
  const superNameFilled = supers.length > 0 || !isBlank(j.field_request_super);

  return (
    <section id="job-info-sec-icbi" className="job-info-block stack">
      <h3 className="job-info-block-heading">
        <span>ICBI</span>
        {progress && (
          <span className={`job-info-count${complete ? " job-info-count--complete" : ""}`}>
            {progress.filled}/{progress.total}
          </span>
        )}
      </h3>
      {loading && <p className="muted small">Loading PM / super lists…</p>}
      {error && <p className="banner banner-warn">{error}</p>}
      <div className="job-info-nonfield">
        <label className="checkbox-row job-info-switch">
          <input
            type="checkbox"
            role="switch"
            checked={j.icbi_is_gc}
            onChange={(e) => onChange({ icbi_is_gc: e.target.checked })}
          />
          ICBI is the GC on this project
        </label>
        {j.icbi_is_gc && (
          <p className="muted small">
            Self-perform paint POs for this job get a trailing <strong>P</strong> (e.g.{" "}
            <code>1126-001P</code>) so they're distinguishable from ICBI's GC-side PO accounting.
          </p>
        )}
      </div>
      <div className="job-info-subgroup">
        <h4 className="job-info-subgroup-heading">People</h4>
        <div className="job-info-people job-info-people--icbi">
          <div className="job-info-people-head" aria-hidden="true">
            <span />
            <span>Name</span>
            <span>Email</span>
          </div>
          <div className={fieldClass(pmNameFilled && !isBlank(j.icbi_pm_email), "job-info-people-row")}>
            <span className="job-info-people-role">PM</span>
            <div className="job-info-people-cell">
              {pmOptions.length > 0 ? (
                <select value={j.icbi_pm} aria-label="PM" onChange={(e) => onPmSelect(e.target.value)}>
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
                  aria-label="PM"
                  className={inputClass(j.icbi_pm)}
                  value={j.icbi_pm}
                  placeholder={profileIsPm ? profile.name.trim() || "Ironwood PM" : "Ironwood PM"}
                  onChange={(e) => onChange({ icbi_pm: e.target.value })}
                />
              )}
            </div>
            <div className="job-info-people-cell">
              <input
                aria-label="PM email"
                type="email"
                className={inputClass(j.icbi_pm_email)}
                value={j.icbi_pm_email}
                placeholder="CC on Field Tools orders"
                onChange={(e) => onChange({ icbi_pm_email: e.target.value })}
              />
              <EmailAddressWarning value={j.icbi_pm_email} compact />
            </div>
          </div>
          <div className={fieldClass(superNameFilled && !isBlank(j.icbi_super_email), "job-info-people-row")}>
            <span className="job-info-people-role">Super</span>
            <div className="job-info-people-cell">
              {supers.length > 0 ? (
                <select
                  aria-label="Super"
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
                  aria-label="Super"
                  className={inputClass(j.field_request_super)}
                  value={j.field_request_super}
                  placeholder="Super from Field Tools"
                  onChange={(e) => onChange({ field_request_super: e.target.value })}
                />
              )}
            </div>
            <div className="job-info-people-cell">
              <input
                aria-label="Super email"
                type="email"
                className={inputClass(j.icbi_super_email)}
                value={j.icbi_super_email}
                onChange={(e) => onChange({ icbi_super_email: e.target.value })}
              />
              <EmailAddressWarning value={j.icbi_super_email} compact />
            </div>
          </div>
          <div className={fieldClass(!isBlank(j.icbi_foreman) && !isBlank(j.icbi_foreman_email), "job-info-people-row")}>
            <span className="job-info-people-role">Foreman</span>
            <input
              aria-label="Foreman"
              className={inputClass(j.icbi_foreman)}
              value={j.icbi_foreman}
              onChange={(e) => onChange({ icbi_foreman: e.target.value })}
            />
            <div className="job-info-people-cell">
              <input
                aria-label="Foreman email"
                type="email"
                className={inputClass(j.icbi_foreman_email)}
                value={j.icbi_foreman_email}
                placeholder="CC on paint tracker & vendor emails"
                onChange={(e) => onChange({ icbi_foreman_email: e.target.value })}
              />
              <EmailAddressWarning value={j.icbi_foreman_email} compact />
            </div>
          </div>
          <div className={fieldClass(!isBlank(j.icbi_estimator), "job-info-people-row")}>
            <span className="job-info-people-role">Estimator</span>
            <input
              aria-label="Estimator"
              className={inputClass(j.icbi_estimator)}
              value={j.icbi_estimator}
              onChange={(e) => onChange({ icbi_estimator: e.target.value })}
            />
            <span className="job-info-people-blank" aria-hidden="true">—</span>
          </div>
          <div className={fieldClass(!isBlank(j.icbi_engineer), "job-info-people-row")}>
            <span className="job-info-people-role">PE</span>
            <input
              aria-label="PE"
              className={inputClass(j.icbi_engineer)}
              value={j.icbi_engineer}
              onChange={(e) => onChange({ icbi_engineer: e.target.value })}
            />
            <span className="job-info-people-blank" aria-hidden="true">—</span>
          </div>
        </div>
      </div>
      <label className={fieldClass(!isBlank(j.icbi_team))}>
        Team
        <input
          className={inputClass(j.icbi_team)}
          value={j.icbi_team}
          placeholder="Internal trade or division sharing this job"
          onChange={(e) => onChange({ icbi_team: e.target.value })}
        />
      </label>
    </section>
  );
}
