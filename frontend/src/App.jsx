import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import CompanionShell from './shells/CompanionShell'
import ConsoleShell from './shells/ConsoleShell'
import { RequireUser, UserProvider } from './state/UserContext'
import CheckIn from './pages/CheckIn'
import Evaluation from './pages/Evaluation'
import Journal from './pages/Journal'
import Lab from './pages/Lab'
import Privacy from './pages/Privacy'
import Report, { ReportLatest } from './pages/Report'
import Run, { RunLatest } from './pages/Run'
import Summary from './pages/Summary'
import Today from './pages/Today'
import Welcome from './pages/Welcome'

/** Routes. The Companion shell hosts the person-facing pages, the Console shell the clinician tools. */
export default function App() {
  return (
    <UserProvider>
      <ToastProvider>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route element={<RequireUser><CompanionShell /></RequireUser>}>
            <Route index element={<Today />} />
            <Route path="journal" element={<Journal />} />
            <Route path="checkin" element={<CheckIn />} />
            <Route path="summary" element={<Summary />} />
            <Route path="privacy" element={<Privacy />} />
          </Route>
          <Route element={<RequireUser><ConsoleShell /></RequireUser>}>
            <Route path="lab" element={<Lab />} />
            <Route path="evaluation" element={<Evaluation />} />
            <Route path="runs" element={<RunLatest />} />
            <Route path="runs/:runId" element={<Run />} />
            <Route path="report" element={<ReportLatest />} />
            <Route path="report/:runId" element={<Report />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </UserProvider>
  )
}
