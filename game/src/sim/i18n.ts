import { messages } from './i18n/messages.ts'

export type Language = 'zh-CN' | 'en'
export type MessageKey = keyof typeof messages

// Presentation state only. The worker and Node start in Chinese; simulation
// rules, station documents and authored names never depend on this setting.
let language: Language = 'zh-CN'
const listeners = new Set<() => void>()
export const getLanguage = (): Language => language
export function setLanguage(next: Language): void {
  if (next === language) return
  language = next
  for (const listener of listeners) listener()
}
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function format(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (slot, index: string) => index in args ? String(args[Number(index)]) : slot)
}
/** Canonical copy for data, stored notices and validation results. */
export function msg(key: MessageKey, ...args: readonly unknown[]): string {
  return format(messages[key].zh, args)
}
/** Use a key directly when authoring new UI. Arguments may include authored names. */
export function t(key: MessageKey, ...args: readonly unknown[]): string {
  return format(messages[key][language === 'en' ? 'en' : 'zh'], args)
}
const exact = new Map<string, string>(Object.values(messages).map(({ zh, en }) => [zh, en]))
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = Object.values(messages)
  .filter(({ zh }) => /\{\d+\}/.test(zh))
  .sort((a, b) => b.zh.replace(/\{\d+\}/g, '').length - a.zh.replace(/\{\d+\}/g, '').length)
  .map(({ zh, en }) => {
    const indexes: number[] = []
    let pattern = '', start = 0
    for (const match of zh.matchAll(/\{(\d+)\}/g)) {
      pattern += escape(zh.slice(start, match.index)) + '(.*?)'
      indexes.push(Number(match[1]))
      start = match.index + match[0].length
    }
    return { pattern: new RegExp('^' + pattern + escape(zh.slice(start)) + '$', 's'), indexes, en }
  })
/** Translate canonical catalogue labels and notices at their presentation boundary.
 * Non-string values pass through, so numeric readouts and React nodes keep their types.
 * Never apply this to authored input values (station names, signs or line termini).
 */
export function translate<T>(value: T): T {
  if (language !== 'en' || typeof value !== 'string') return value
  const direct = exact.get(value)
  if (direct !== undefined) return direct as T
  for (const { pattern, indexes, en } of templates) {
    const match = pattern.exec(value)
    if (!match) continue
    const args: string[] = []
    indexes.forEach((index, i) => { args[index] = translate(match[i + 1]) })
    return format(en, args) as T
  }
  // Composite readouts join independent labels with punctuation (LOS, clock,
  // dimensions). Translate each label without rewriting arbitrary substrings.
  const parts = value.split(/(\s+|[·/：:，,（）()]+)/)
  return (parts.length > 1 ? parts.map(part => /^[\s·/：:，,（）()]+$/.test(part) ? part : translate(part)).join('') : value) as T
}
export function languageForPath(path: string): Language {
  return path.split('/').includes('en') ? 'en' : 'zh-CN'
}
