import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { LetterheadProvider } from "./contexts/LetterheadContext";
import { ProtectedRoute } from "./components/Layout";
import { ProjectLayout } from "./components/ProjectLayout";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectOverviewPage } from "./pages/ProjectOverviewPage";
import { ProjectRfisPage } from "./pages/ProjectRfisPage";
import { RfiEditorPage } from "./pages/RfiEditorPage";
import { SubmittalsPage } from "./pages/SubmittalsPage";
import { PaintSubmittalsPage } from "./pages/PaintSubmittalsPage";
import { WallcoveringSubmittalsPage } from "./pages/WallcoveringSubmittalsPage";
import { TransmittalPage } from "./pages/TransmittalPage";
import { SdsPacketPage } from "./pages/SdsPacketPage";
import { GoogleSheetsPage } from "./pages/GoogleSheetsPage";
import { ExcelPasteHelperPage } from "./pages/ExcelPasteHelperPage";
import { BudgetPage } from "./pages/BudgetPage";
import { BillingPage } from "./pages/BillingPage";
import { ProjectWorkOrdersPage } from "./pages/ProjectWorkOrdersPage";
import { MaterialTrackerPage } from "./pages/MaterialTrackerPage";
import { WorkOrderEditorPage } from "./pages/WorkOrderEditorPage";
import { FrpSubmittalsPage } from "./pages/FrpSubmittalsPage";
import { ApprovedBrushoutsPage } from "./pages/ApprovedBrushoutsPage";
import { ProjectOrdersPage } from "./pages/ProjectOrdersPage";
import { ProjectPoPage } from "./pages/ProjectPoPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BrushOutRequestPage } from "./pages/BrushOutRequestPage";
import { FieldDashboardLayout } from "./pages/field/FieldDashboardLayout";
import { FieldCalendarDashboardPage } from "./pages/field/FieldCalendarDashboardPage";
import { FieldManpowerPlanPage } from "./pages/field/FieldManpowerPlanPage";
import { FieldWorkloadPage } from "./pages/field/FieldWorkloadPage";
import { FieldPaintDashboardPage } from "./pages/field/FieldPaintDashboardPage";
import { FieldWallcoveringDashboardPage } from "./pages/field/FieldWallcoveringDashboardPage";
import { CompanyWorkloadPage } from "./pages/CompanyWorkloadPage";
import { SubmittalsHubLayout } from "./components/submittals/SubmittalsHubLayout";

export default function App() {
  return (
    <AuthProvider>
      <LetterheadProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/field" element={<FieldDashboardLayout />}>
            <Route index element={<Navigate to="paint" replace />} />
            <Route path="wallcovering" element={<FieldWallcoveringDashboardPage />} />
            <Route path="paint" element={<FieldPaintDashboardPage />} />
            <Route path="calendar" element={<FieldCalendarDashboardPage />} />
            <Route path="manpower" element={<FieldManpowerPlanPage />} />
            <Route path="workload" element={<FieldWorkloadPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/workload" element={<CompanyWorkloadPage />} />
            <Route path="/brush-out-request" element={<BrushOutRequestPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="rfis" element={<ProjectRfisPage />} />
              <Route path="rfis/:rfiId" element={<RfiEditorPage />} />
              <Route path="submittals" element={<SubmittalsHubLayout />}>
                <Route index element={<SubmittalsPage />} />
                <Route path="paint" element={<PaintSubmittalsPage />} />
                <Route path="wallcovering" element={<WallcoveringSubmittalsPage />} />
                <Route path="frp" element={<FrpSubmittalsPage />} />
                <Route path="package" element={<SdsPacketPage />} />
                <Route path="transmittal" element={<TransmittalPage />} />
              </Route>
              {/* Legacy: procurement log now lives in Material Tracker → Log tab */}
              <Route path="procurement-log" element={<Navigate to="../material-tracker?tab=log" replace />} />
              <Route path="google-sheets" element={<GoogleSheetsPage />} />
              <Route path="excel-paste" element={<ExcelPasteHelperPage />} />
              <Route path="approved-brushouts" element={<ApprovedBrushoutsPage />} />
              <Route path="track" element={<Navigate to="../orders" replace />} />
              <Route path="po" element={<ProjectPoPage />} />
              <Route path="orders" element={<ProjectOrdersPage />} />
              <Route path="budget" element={<BudgetPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="work-orders" element={<ProjectWorkOrdersPage />} />
              <Route path="work-orders/:workOrderId" element={<WorkOrderEditorPage />} />
              <Route path="material-tracker" element={<MaterialTrackerPage />} />
              {/* Legacy paths → Submittals hub */}
              <Route path="paint" element={<Navigate to="../submittals/paint" replace />} />
              <Route path="wallcovering" element={<Navigate to="../submittals/wallcovering" replace />} />
              <Route path="frp" element={<Navigate to="../submittals/frp" replace />} />
              <Route path="sds" element={<Navigate to="../submittals/package" replace />} />
              <Route path="transmittal" element={<Navigate to="../submittals/transmittal" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
        </BrowserRouter>
      </LetterheadProvider>
    </AuthProvider>
  );
}
