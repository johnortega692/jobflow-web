import { Navigate, useParams } from "react-router-dom";

/** Legacy route — Google Sheets lives on the project dashboard. */
export function GoogleSheetsPage() {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId}#google-sheets`} replace />;
}
