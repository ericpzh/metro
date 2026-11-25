export const UI_SCALE_MIN = 0.75
export const UI_SCALE_MAX = 1.5
export const UI_SCALE_STEP = 0.01
export const UI_SCALE_STORAGE_KEY = 'metro-game.ui-scale'

export interface UiScaleState {
  scale: number
  defaultScale: number
  custom: boolean
}

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value))
  const stepped = Math.round(clamped / UI_SCALE_STEP) * UI_SCALE_STEP
  return Number(Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, stepped)).toFixed(2))
}

/**
 * Default UI scale per viewport resolution, keeping panel proportions balanced
 * from compact 720p windows up to 4K displays within the 75%–150% slider range.
 */
export function defaultUiScaleForViewport(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  if (width >= 3200 && height >= 1800) return 1.5
  if (width >= 2400 && height >= 1300) return 1.25
  if (width >= 1760 && height >= 900) return 1
  if (width >= 1500 && height >= 800) return 0.9
  if (width >= 1340 && height >= 740) return 0.85
  return 0.75
}

export function readSavedUiScale(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(UI_SCALE_STORAGE_KEY)
    if (!raw || raw === 'auto') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? clampUiScale(parsed) : null
  } catch {
    return null
  }
}

function viewportDimensions(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  return {
    width: window.innerWidth || 1920,
    height: window.innerHeight || 1080,
  }
}

let state: UiScaleState = { scale: 1, defaultScale: 1, custom: false }
const listeners = new Set<() => void>()
let resizeListenerAttached = false

export const getUiScale = (): number => state.scale
export const getUiScaleState = (): UiScaleState => state

export function subscribeUiScale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function applyScale(next: UiScaleState): void {
  const changed = next.scale !== state.scale || next.defaultScale !== state.defaultScale || next.custom !== state.custom
  state = next
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style?.setProperty('--ui-scale', String(next.scale))
    document.documentElement.dataset.uiScale = String(Math.round(next.scale * 100))
  }
  if (changed) {
    for (const listener of listeners) listener()
  }
}

export function syncUiScaleForViewport(width: number, height: number): void {
  const defaultScale = defaultUiScaleForViewport(width, height)
  const scale = state.custom ? state.scale : defaultScale
  applyScale({ scale, defaultScale, custom: state.custom })
}

export function initUiScale(): void {
  const { width, height } = viewportDimensions()
  const defaultScale = defaultUiScaleForViewport(width, height)
  let saved: number | null = null
  try {
    if (typeof localStorage !== 'undefined') saved = readSavedUiScale(localStorage)
  } catch {
    saved = null
  }
  const next: UiScaleState = saved !== null
    ? { scale: saved, defaultScale, custom: true }
    : { scale: defaultScale, defaultScale, custom: false }
  state = { scale: -1, defaultScale: -1, custom: !next.custom }
  applyScale(next)

  if (!resizeListenerAttached && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    resizeListenerAttached = true
    window.addEventListener('resize', () => {
      const dims = viewportDimensions()
      syncUiScaleForViewport(dims.width, dims.height)
    })
  }
}

export function beginUiScaleDrag(): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.style?.setProperty('--ui-scale-drag', String(state.scale))
  document.documentElement.dataset.uiScaling = 'true'
}

export function endUiScaleDrag(): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  delete document.documentElement.dataset.uiScaling
  document.documentElement.style?.removeProperty('--ui-scale-drag')
}

export function setUiScale(scale: number, options?: { persist?: boolean }): void {
  const clamped = clampUiScale(scale)
  applyScale({ scale: clamped, defaultScale: state.defaultScale, custom: true })
  if (options?.persist === false) return
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(UI_SCALE_STORAGE_KEY, String(clamped))
  } catch { /* Keep the session preference. */ }
}

export function resetUiScale(): void {
  const { width, height } = viewportDimensions()
  const defaultScale = defaultUiScaleForViewport(width, height)
  applyScale({ scale: defaultScale, defaultScale, custom: false })
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(UI_SCALE_STORAGE_KEY)
  } catch { /* Keep the session preference. */ }
}
