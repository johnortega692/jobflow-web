import { useCallback } from "react";
import { CompanyWorkloadCalendar } from "../../components/workload/CompanyWorkloadCalendar";
import { useAuth } from "../../contexts/AuthContext";
import {
  fetchCompanyManpowerActiveCrew,
  fetchCompanyManpowerActiveProjects,
  fetchCompanyManpowerWorkload,
  fetchFieldViewCompanyManpowerActiveProjects,
  fetchFieldViewCompanyManpowerWorkload,
  fetchFieldViewManpowerActiveCrew,
} from "../../lib/companyManpowerWorkload";
import { useFieldDashboard } from "./FieldDashboardLayout";

export function FieldWorkloadPage() {
  const { mobileView, darkMode } = useFieldDashboard();
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

  const fetchActiveProjects = useCallback(
    () =>
      user ? fetchCompanyManpowerActiveProjects() : fetchFieldViewCompanyManpowerActiveProjects(),
    [user],
  );

  return (
    <CompanyWorkloadCalendar
      fetchWeeks={fetchWeeks}
      fetchActiveCrew={fetchActiveCrew}
      fetchActiveProjects={fetchActiveProjects}
      loadingMessage="Loading company workload…"
      mobileView={mobileView}
      darkMode={darkMode}
      showThemeToggle={false}
    />
  );
}
