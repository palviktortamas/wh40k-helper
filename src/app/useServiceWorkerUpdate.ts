import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export type SwUpdate = {
  /** A newer build is precached and waiting to take over. */
  updateAvailable: boolean
  /** Everything needed to run offline has been cached. */
  offlineReady: boolean
  applyUpdate: () => void
  dismiss: () => void
}

/**
 * Wires the service worker to a "new version available — reload" prompt.
 * registerType is 'prompt' so a mid-game update never reloads under the player.
 */
export function useServiceWorkerUpdate(): SwUpdate {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [apply, setApply] = useState<(() => void) | null>(null)

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateAvailable(true),
      onOfflineReady: () => setOfflineReady(true),
    })
    // Stored via updater form: React would otherwise call the function itself.
    setApply(() => () => void update(true))
  }, [])

  return {
    updateAvailable,
    offlineReady,
    applyUpdate: () => apply?.(),
    dismiss: () => {
      setUpdateAvailable(false)
      setOfflineReady(false)
    },
  }
}
