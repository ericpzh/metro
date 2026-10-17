// Browser-local preference and anonymous identity for the global stats service.
// Storage is optional everywhere: private browsing or a blocked store must not
// stop the game, it just makes the preference in-memory and the identity
// per-session.

export const SHARE_STATS_KEY = 'metro-game.share-stats.v1'
export const STATS_CLIENT_KEY = 'metro-game.stats-client-id.v1'

export interface StatsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function browserStorage(): StatsStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

/** Sharing is on by default; only an explicit stored `off` turns it off. */
export function readShareStats(storage: StatsStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(SHARE_STATS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveShareStats(on: boolean, storage: StatsStorage | null = browserStorage()): void {
  try {
    storage?.setItem(SHARE_STATS_KEY, on ? 'on' : 'off')
  } catch { /* The preference stays in memory for this session. */ }
}

export function createStatsId(): string {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // The game targets browsers with randomUUID; this keeps a blocked/older host
  // from making the stats client throw. It is an I/O id, never a sim draw.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f][0-9a-f-]{7,63}$/i.test(value)
}

/**
 * A stable anonymous id in this browser, never a fingerprint. A missing or
 * invalid stored value is replaced; blocked storage gets a per-session id.
 */
export function readStatsClientId(
  storage: StatsStorage | null = browserStorage(),
  createId: () => string = createStatsId
): string {
  try {
    const stored = storage?.getItem(STATS_CLIENT_KEY)
    if (stored && isUuidLike(stored)) return stored
  } catch { /* Fall through to a fresh id. */ }
  const id = createId()
  try {
    storage?.setItem(STATS_CLIENT_KEY, id)
  } catch { /* The id lives for this session only. */ }
  return id
}
