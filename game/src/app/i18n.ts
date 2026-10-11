import { useSyncExternalStore } from 'react'
import { getLanguage, languageForPath, setLanguage, subscribeLanguage, t } from '../sim/i18n.ts'
export { getLanguage, setLanguage, t } from '../sim/i18n.ts'

const STORAGE_KEY = 'metro-game.language'
export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}
/** The URL sets the initial language; a deliberate toggle is remembered on reload.
 * Each route has its own preference, so a first visit to /en always opens English.
 */
export function initLanguage(): void {
  const routeLanguage = languageForPath(location.pathname)
  const key = `${STORAGE_KEY}.${routeLanguage}`
  let saved: string | null = null
  try { saved = localStorage.getItem(key) } catch { /* private browsing */ }
  setLanguage(saved === 'en' || saved === 'zh-CN' ? saved : routeLanguage)
  const reflect = (): void => {
    document.documentElement.lang = getLanguage()
    document.title = t('metro_station_designer')
  }
  reflect()
  subscribeLanguage(() => {
    reflect()
    try { localStorage.setItem(key, getLanguage()) } catch { /* storage unavailable */ }
  })
}
