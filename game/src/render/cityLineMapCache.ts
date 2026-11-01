import { normalizeCityStyle, type CityStyle } from '../sim/cityStyles.ts'
import type { LineMapArt } from './lineMapArt.ts'

/** Decode only requested cities, sharing simultaneous requests and retained faces. */
export function cityLineMapCache(posters: Record<CityStyle, LineMapArt>): LineMapArt {
  const pending = new Map<CityStyle, Promise<void>>()
  let disposed = false
  return {
    async load(onReady, city) {
      if (disposed) return
      const selected = normalizeCityStyle(city), art = posters[selected]
      let request = pending.get(selected)
      if (!request) { request = art.load(); pending.set(selected, request) }
      try { await request } finally { pending.delete(selected) }
      if (!disposed && art.ready()) onReady?.()
    },
    ready(city) { return posters[normalizeCityStyle(city)].ready() },
    face(w, h, city) { return posters[normalizeCityStyle(city)].face(w, h) },
    dispose() {
      if (disposed) return
      disposed = true
      for (const art of Object.values(posters)) art.dispose()
      pending.clear()
    },
  }
}
