import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { useTheme } from './app/useTheme'
import { Rosters } from './screens/Rosters'
import { RosterEditor } from './screens/RosterEditor'
import { Play } from './screens/Play'
import { Game } from './screens/Game'
import { Missions } from './screens/Missions'
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
          <Route path="/rosters/:rosterId" element={<RosterEditor />} />
          <Route path="/play" element={<Play />} />
          <Route path="/play/:gameId" element={<Game />} />
          <Route path="/data" element={<Data />} />
          <Route path="/missions" element={<Missions />} />
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
