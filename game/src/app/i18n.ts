import { useSyncExternalStore } from 'react'
import { getLanguage, setLanguage, subscribeLanguage, t } from '../sim/i18n.ts'
import { initialLanguageForRoute } from './languageRoute.ts'
export { getLanguage, setLanguage, t } from '../sim/i18n.ts'

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}
/** The URL sets the initial language; a deliberate toggle is remembered on reload.
 * Each game route has its own preference, so a first visit to /game/en/ always opens English.
 * Benchmark routes stay isolated from the game's saved override.
 */
export function initLanguage(): void {
  let storage: Storage | null = null
  try { storage = localStorage } catch { /* private browsing */ }
  const { language, storageKey } = initialLanguageForRoute(location.pathname, storage)
  setLanguage(language)
  const reflect = (): void => {
    document.documentElement.lang = getLanguage()
    document.title = t('metro_station_designer')
  }
  reflect()
  subscribeLanguage(() => {
    reflect()
    if (!storageKey) return
    try { localStorage.setItem(storageKey, getLanguage()) } catch { /* storage unavailable */ }
  })
}
