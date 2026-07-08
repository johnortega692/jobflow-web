import { useCallback } from "react";
import { CompanyWorkloadCalendar } from "../components/workload/CompanyWorkloadCalendar";
import { fetchCompanyManpowerActiveCrew, fetchCompanyManpowerWorkload } from "../lib/companyManpowerWorkload";
import "../field-dashboard.css";

export function CompanyWorkloadPage() {
  const fetchWeeks = useCallback(
    (fromWeek: string, toWeek: string) => fetchCompanyManpowerWorkload(fromWeek, toWeek),
    [],
  );

  const fetchActiveCrew = useCallback(() => fetchCompanyManpowerActiveCrew(), []);

  return (
    <div className="field-dashboard">
      <div className="stack" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: "1.35rem" }}>Company workload</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Read-only calendar of planned manpower hours from all project billing plans. Use with supers to spot light
            weeks and plan hiring or pipeline.
          </p>
        </div>
        <CompanyWorkloadCalendar
          fetchWeeks={fetchWeeks}
          fetchActiveCrew={fetchActiveCrew}
          loadingMessage="Loading company workload…"
        />
      </div>
    </div>
  );
}
