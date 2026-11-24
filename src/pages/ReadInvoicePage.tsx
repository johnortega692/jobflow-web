import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { MaterialPricesSettingsSection } from "../components/settings/MaterialPricesSettingsSection";

export function ReadInvoicePage() {
  const [params] = useSearchParams();
  const projectId = params.get("project")?.trim() || undefined;
  return (
    <div className="stack read-invoice-page">
      <h2 className="page-title">Read invoice</h2>
      <MaterialPricesSettingsSection invoiceOnly projectId={projectId} />
    </div>
  );
}

export function ProjectReadInvoiceRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/read-invoice?project=${projectId}` : "/read-invoice"} replace />;
}
