const KEY = 'metro-game.edge-scrolling'

/** Edge scrolling is enabled by default; only an explicit stored off disables it. */
export function readEdgeScrolling(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function saveEdgeScrolling(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* Keep the preference in memory for this session. */ }
}
