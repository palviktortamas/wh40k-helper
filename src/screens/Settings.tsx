import { useOutletContext } from 'react-router-dom'
import type { Theme } from '@/app/useTheme'
import './Settings.css'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

export function Settings() {
  const [theme, setTheme] = useOutletContext<[Theme, (next: Theme) => void]>()

  return (
    <section className="settings">
      <h2>Settings</h2>

      <fieldset className="settings__group">
        <legend>Theme</legend>
        <div className="settings__choices">
          {THEMES.map((option) => (
            <label key={option.value} className="settings__choice">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <h3>About</h3>
      <p>
        Version {__APP_VERSION__} ({__BUILD_COMMIT__})
      </p>
      <p>
        An unofficial, private helper for Warhammer 40,000 11th Edition. It is not published, has
        no accounts, no backend and no analytics — everything stays on this device.
      </p>
      <p>
        Game data is provided by the <a href="https://github.com/BSData/wh40k-11e">BSData</a>{' '}
        community and <a href="https://wahapedia.ru/wh40k11ed/">Wahapedia</a> ("powered by
        Wahapedia"); points come from the official{' '}
        <a href="https://mfm.warhammer-community.com/en">Munitorum Field Manual</a>.
      </p>
      <p className="settings__fineprint">
        Warhammer 40,000 and all associated names, marks and images are © Games Workshop Limited.
        This app is unofficial and unaffiliated.
      </p>
    </section>
  )
}
