import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
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
import { ComingSoonPage } from "./pages/ComingSoonPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="rfis" element={<ProjectRfisPage />} />
              <Route path="rfis/:rfiId" element={<RfiEditorPage />} />
              <Route path="submittals" element={<SubmittalsPage />} />
              <Route path="transmittal" element={<TransmittalPage />} />
              <Route path="paint" element={<PaintSubmittalsPage />} />
              <Route path="wallcovering" element={<WallcoveringSubmittalsPage />} />
              <Route
                path="frp"
                element={
                  <ComingSoonPage title="FRP" detail="FRP submittals and order forms." />
                }
              />
              <Route
                path="track"
                element={
                  <ComingSoonPage
                    title="Track"
                    detail="Stretched-fabric track order forms and profiles."
                  />
                }
              />
              <Route
                path="sds"
                element={
                  <ComingSoonPage
                    title="SDS / TDS packet"
                    detail="Assemble SDS and TDS PDF packets with cover and dividers."
                  />
                }
              />
              <Route
                path="budget"
                element={
                  <ComingSoonPage
                    title="Budget"
                    detail="Foundation Software J/C budget CSV export."
                  />
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
