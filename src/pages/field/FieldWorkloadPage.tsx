import { useCallback } from "react";
import { CompanyWorkloadCalendar } from "../../components/workload/CompanyWorkloadCalendar";
import { useAuth } from "../../contexts/AuthContext";
import {
  fetchCompanyManpowerActiveCrew,
  fetchCompanyManpowerWorkload,
  fetchFieldViewCompanyManpowerWorkload,
  fetchFieldViewManpowerActiveCrew,
} from "../../lib/companyManpowerWorkload";
import { useFieldDashboard } from "./FieldDashboardLayout";

export function FieldWorkloadPage() {
  const { mobileView } = useFieldDashboard();
  const { user } = useAuth();

  const fetchWeeks = useCallback(
    (fromWeek: string, toWeek: string) =>
      user
        ? fetchCompanyManpowerWorkload(fromWeek, toWeek)
        : fetchFieldViewCompanyManpowerWorkload(fromWeek, toWeek),
    [user],
  );

  const fetchActiveCrew = useCallback(
    () => (user ? fetchCompanyManpowerActiveCrew() : fetchFieldViewManpowerActiveCrew()),
    [user],
  );

  return (
    <CompanyWorkloadCalendar
      fetchWeeks={fetchWeeks}
      fetchActiveCrew={fetchActiveCrew}
      loadingMessage="Loading company workload…"
      mobileView={mobileView}
    />
  );
}
