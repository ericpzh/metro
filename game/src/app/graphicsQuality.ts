import type { GraphicsQuality } from '../render/detailPolicy.ts'
const KEY = 'metro-game.graphics-quality'
export function readGraphicsQuality(): GraphicsQuality {
  try { return localStorage.getItem(KEY) === 'low' ? 'low' : 'high' } catch { return 'high' }
}
export function saveGraphicsQuality(quality: GraphicsQuality): void {
  try { localStorage.setItem(KEY, quality) } catch { /* Preference storage may be unavailable. */ }
}
