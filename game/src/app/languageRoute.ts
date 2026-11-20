import { languageForPath, type Language } from '../sim/i18n.ts'

export const LANGUAGE_STORAGE_KEY = 'metro-game.language'

export function isBenchmarkPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '')
  return path.endsWith('/benchmark') || path.endsWith('/benchmark/en')
}

export function benchmarkLanguagePath(pathname: string, language: Language): string {
  const cleanPath = pathname.replace(/\/+$/, '')
  const basePath = cleanPath.endsWith('/benchmark/en')
    ? cleanPath.slice(0, -3)
    : cleanPath.endsWith('/en/benchmark')
      ? `${cleanPath.slice(0, -'/en/benchmark'.length)}/benchmark`
      : cleanPath
  return language === 'en' ? `${basePath}/en` : basePath
}

/**
 * The URL sets the initial language; a deliberate toggle in the game is remembered
 * per route on reload. Benchmark routes stay isolated from the game's saved
 * preference so external links (`/benchmark` vs `/benchmark/en`) always open in
 * their routed language and the in-page toggle has the final say without clobbering
 * the player's game setting.
 */
export function initialLanguageForRoute(
  pathname: string,
  storage?: Pick<Storage, 'getItem'> | null,
): { language: Language; storageKey: string | null } {
  const routeLanguage = languageForPath(pathname)
  if (isBenchmarkPath(pathname)) {
    return { language: routeLanguage, storageKey: null }
  }
  const storageKey = `${LANGUAGE_STORAGE_KEY}.${routeLanguage}`
  let saved: string | null = null
  try { saved = storage?.getItem(storageKey) ?? null } catch { /* private browsing */ }
  return {
    language: saved === 'en' || saved === 'zh-CN' ? saved : routeLanguage,
    storageKey,
  }
}
