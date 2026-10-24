export interface AudioVolumes { master: number; effects: number; ambient: number; music: number }
/** Preserve the deployed /game prefix while keeping language/demo routes out of asset paths. */
export function audioAssetBase(pathname:string):string {
  const segments=pathname.split('/').filter(Boolean)
  if(['lab','zoo','tanwei'].includes(segments.at(-1)??''))segments.pop()
  if(segments.at(-1)==='en')segments.pop()
  return `/${segments.length?segments.join('/')+'/':''}audio/`
}
const KEY = 'metro-game.audio'
const defaults: AudioVolumes = { master: 1, effects: .65, ambient: .45, music: .25 }
export function sanitizeAudioVolumes(value: unknown): AudioVolumes {
  const v = value as Partial<AudioVolumes> | null
  const volume = (n: unknown, fallback: number): number => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
  return { master: volume(v?.master, defaults.master), effects: volume(v?.effects, defaults.effects), ambient: volume(v?.ambient, defaults.ambient), music: volume(v?.music, defaults.music) }
}
export function readAudioVolumes(): AudioVolumes {
  try { return sanitizeAudioVolumes(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return { ...defaults } }
}
let current = readAudioVolumes()
const listeners = new Set<() => void>()
export const getAudioVolumes = (): AudioVolumes => current
export function subscribeAudioVolumes(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setAudioVolume(key: keyof AudioVolumes, value: number): void {
  current = sanitizeAudioVolumes({ ...current, [key]: value })
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* Keep session controls functional. */ }
  for (const listener of listeners) listener()
}
