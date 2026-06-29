import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { LetterheadProvider } from "./contexts/LetterheadContext";
import { ProtectedRoute } from "./components/Layout";
import { ProjectLayout } from "./components/ProjectLayout";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProcurementLogPage } from "./pages/ProcurementLogPage";
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
import { ProjectWorkOrdersPage } from "./pages/ProjectWorkOrdersPage";
import { WorkOrderEditorPage } from "./pages/WorkOrderEditorPage";
import { FrpSubmittalsPage } from "./pages/FrpSubmittalsPage";
import { ApprovedBrushoutsPage } from "./pages/ApprovedBrushoutsPage";
import { ProjectOrdersPage } from "./pages/ProjectOrdersPage";
import { ProjectPoPage } from "./pages/ProjectPoPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BrushOutRequestPage } from "./pages/BrushOutRequestPage";
import { FieldDashboardLayout } from "./pages/field/FieldDashboardLayout";
import { FieldCalendarDashboardPage } from "./pages/field/FieldCalendarDashboardPage";
import { FieldPaintDashboardPage } from "./pages/field/FieldPaintDashboardPage";
import { FieldWallcoveringDashboardPage } from "./pages/field/FieldWallcoveringDashboardPage";

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
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/brush-out-request" element={<BrushOutRequestPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="rfis" element={<ProjectRfisPage />} />
              <Route path="rfis/:rfiId" element={<RfiEditorPage />} />
              <Route path="submittals" element={<SubmittalsPage />} />
              <Route path="procurement-log" element={<ProcurementLogPage />} />
              <Route path="transmittal" element={<TransmittalPage />} />
              <Route path="google-sheets" element={<GoogleSheetsPage />} />
              <Route path="excel-paste" element={<ExcelPasteHelperPage />} />
              <Route path="paint" element={<PaintSubmittalsPage />} />
              <Route path="approved-brushouts" element={<ApprovedBrushoutsPage />} />
              <Route path="wallcovering" element={<WallcoveringSubmittalsPage />} />
              <Route path="frp" element={<FrpSubmittalsPage />} />
              <Route path="track" element={<Navigate to="../orders" replace />} />
              <Route path="po" element={<ProjectPoPage />} />
              <Route path="orders" element={<ProjectOrdersPage />} />
              <Route path="sds" element={<SdsPacketPage />} />
              <Route path="budget" element={<BudgetPage />} />
              <Route path="work-orders" element={<ProjectWorkOrdersPage />} />
              <Route path="work-orders/:workOrderId" element={<WorkOrderEditorPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
        </BrowserRouter>
      </LetterheadProvider>
    </AuthProvider>
  );
}
