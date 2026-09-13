import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { reparseStaleCatalogues } from '@/data/worker/client'
import { ensureMissionDeck } from '@/missions/store'
import { useServiceWorkerUpdate } from './useServiceWorkerUpdate'
import './AppShell.css'

const TABS = [
  { to: '/rosters', label: 'Rosters', icon: 'M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z' },
  { to: '/play', label: 'Play', icon: 'M8 5v14l11-7z' },
  { to: '/data', label: 'Data', icon: 'M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm0 2c-3.5 0-6 .9-6 1s2.5 1 6 1 6-.9 6-1-2.5-1-6-1z' },
  { to: '/settings', label: 'Settings', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 4a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 00-2-1.2L16 3H8l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 002 1.2L8 21h8l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z' },
] as const

type Props = {
  /** Handed to every routed screen via useOutletContext. */
  context: unknown
}

export function AppShell({ context }: Props) {
  const sw = useServiceWorkerUpdate()

  // A parser fix reaches installed factions from their stored raw text — offline, once per start.
  // The mission deck the build shipped is imported the first time the app runs.
  useEffect(() => {
    void reparseStaleCatalogues()
    void ensureMissionDeck()
  }, [])

  return (
    <div className="shell">
      <header className="shell__header">
        <h1>WH40k Play Helper</h1>
      </header>

      <main className="shell__main">
        <Outlet context={context} />
      </main>

      <nav className="shell__nav" aria-label="Main">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={tab.icon} />
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {sw.updateAvailable && (
        <div className="toast" role="status">
          <p>New version available.</p>
          <button onClick={sw.applyUpdate}>Reload</button>
          <button className="toast__dismiss" onClick={sw.dismiss} aria-label="Dismiss">
            Later
          </button>
        </div>
      )}
      {!sw.updateAvailable && sw.offlineReady && (
        <div className="toast" role="status">
          <p>Ready to work offline.</p>
          <button className="toast__dismiss" onClick={sw.dismiss}>
            OK
          </button>
        </div>
      )}
    </div>
  )
}
