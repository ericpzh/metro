export type UiTheme = 'blueprint' | 'site' | 'studio'
export const uiThemes: readonly UiTheme[] = ['blueprint', 'site', 'studio']
const KEY = 'metro-game.ui-theme'

export function readUiTheme(storage: Pick<Storage, 'getItem'>): UiTheme {
  try {
    const saved = storage.getItem(KEY)
    return saved === 'site' || saved === 'studio' ? saved : 'blueprint'
  } catch { return 'blueprint' }
}

let current: UiTheme = 'blueprint'
const listeners = new Set<() => void>()
export const getUiTheme = (): UiTheme => current
export const themeVoidColor = (theme: UiTheme): number => theme === 'studio' ? 0xf4f3ed : 0x0b0f16
export function subscribeUiTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function applyTheme(theme: UiTheme): void {
  current = theme
  document.documentElement.dataset.uiTheme = theme
  for (const listener of listeners) listener()
}
export function initUiTheme(): void {
  try { applyTheme(readUiTheme(localStorage)) } catch { applyTheme('blueprint') }
}
export function setUiTheme(theme: UiTheme): void {
  applyTheme(theme)
  try { localStorage.setItem(KEY, theme) } catch { /* Keep the session preference. */ }
}
