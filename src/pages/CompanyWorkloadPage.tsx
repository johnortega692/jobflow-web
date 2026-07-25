import { useCallback, useState } from "react";
import { CompanyWorkloadCalendar } from "../components/workload/CompanyWorkloadCalendar";
import {
  fetchCompanyManpowerActiveCrew,
  fetchCompanyManpowerActiveProjects,
  fetchCompanyManpowerWorkload,
} from "../lib/companyManpowerWorkload";
import { readWorkloadDarkMode, writeWorkloadDarkMode } from "../lib/fieldViewPrefs";
import "../field-dashboard.css";

export function CompanyWorkloadPage() {
  const [darkMode, setDarkMode] = useState(readWorkloadDarkMode);

  const fetchWeeks = useCallback(
    (fromWeek: string, toWeek: string) => fetchCompanyManpowerWorkload(fromWeek, toWeek),
    [],
  );

  const fetchActiveCrew = useCallback(() => fetchCompanyManpowerActiveCrew(), []);
  const fetchActiveProjects = useCallback(() => fetchCompanyManpowerActiveProjects(), []);

  const handleDarkModeChange = useCallback((value: boolean) => {
    setDarkMode(value);
    writeWorkloadDarkMode(value);
  }, []);

  return (
    <div className={`field-dashboard${darkMode ? " field-dashboard--dark" : ""}`}>
      <div className="stack field-workload-page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div>
          <h1 className="field-workload-page-title">Company workload</h1>
          <p className="field-workload-page-sub">
            Read-only calendar of planned manpower hours from all project billing plans. Use with supers to spot light
            weeks and plan hiring or pipeline.
          </p>
        </div>
        <CompanyWorkloadCalendar
          fetchWeeks={fetchWeeks}
          fetchActiveCrew={fetchActiveCrew}
          fetchActiveProjects={fetchActiveProjects}
          loadingMessage="Loading company workload…"
          darkMode={darkMode}
          onDarkModeChange={handleDarkModeChange}
        />
      </div>
    </div>
  );
}
