import { useEffect, useState } from 'react'
import { getSetting, setSetting } from '@/data/db'

export type Theme = 'dark' | 'light' | 'system'
const KEY = 'theme'

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    void getSetting<Theme>(KEY, 'dark').then(setThemeState)
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  return [
    theme,
    (next) => {
      setThemeState(next)
      void setSetting(KEY, next)
    },
  ]
}
