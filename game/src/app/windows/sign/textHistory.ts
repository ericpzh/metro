const KEY = 'metro-sign-text-history'
const LIMIT = 8

export function recentSignTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || result.includes(item)) continue
    result.push(item)
    if (result.length === LIMIT) break
  }
  return result
}

export function readSignTextHistory(): string[] {
  try { return recentSignTexts(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return [] }
}

export function saveSignTextHistory(history: readonly string[], text: string, replace?: string): string[] {
  const next = recentSignTexts([text, ...history.filter((item) => item !== replace)])
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* Keep the history in memory. */ }
  return next
}
