import { useEffect } from 'react'

/**
 * Keeps the screen on while a game is open (spec §3). Best effort: the API is
 * absent on some browsers and the lock is released when the tab is hidden, so
 * it is re-requested on return.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // Low battery or a denied request; the game works without it.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    }
  }, [active])
}
