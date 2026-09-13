import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { useTheme } from './app/useTheme'
import { Rosters } from './screens/Rosters'
import { Play } from './screens/Play'
import { Data } from './screens/Data'
import { DataHealth } from './screens/DataHealth'
import { Datasheets } from './screens/Datasheets'
import { DatasheetDetail } from './screens/DatasheetDetail'
import { Settings } from './screens/Settings'

export function App() {
  const theme = useTheme()

  return (
    // Hash routing keeps deep links working on a static host with no rewrite
    // rules, and survives being launched from the installed PWA icon.
    <HashRouter>
      <Routes>
        <Route element={<AppShell context={theme} />}>
          <Route index element={<Navigate to="/rosters" replace />} />
          <Route path="/rosters" element={<Rosters />} />
          <Route path="/play" element={<Play />} />
          <Route path="/data" element={<Data />} />
          <Route path="/datasheets/:catalogueId" element={<Datasheets />} />
          <Route path="/datasheets/:catalogueId/:datasheetId" element={<DatasheetDetail />} />
          <Route path="/health/:catalogueId" element={<DataHealth />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/rosters" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
