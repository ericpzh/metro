import { UPSCALING_SCALE } from '../render/upscaling.ts'
import type { UpscalingMode } from '../render/upscaling.ts'

const KEY = 'metro-game.upscaling'

export function readUpscalingMode(): UpscalingMode {
  try {
    const saved = localStorage.getItem(KEY)
    return saved && saved in UPSCALING_SCALE ? saved as UpscalingMode : 'native'
  } catch { return 'native' }
}

export function saveUpscalingMode(mode: UpscalingMode): void {
  try { localStorage.setItem(KEY, mode) } catch { /* Storage may be unavailable. */ }
}

