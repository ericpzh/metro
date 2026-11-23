// Out-of-band browser canvas painter for Unity train cab & side city marks
// (plan 37 Track 3). Mirrors `signFaceProvider.ts` / `calligraphyFaceProvider.ts`
// using the exact Web painters (`cityBranding.ts`, `chengduBranding.ts`,
// `beijingTrainMark.ts`, `nanjingBranding.ts`, `chongqingBranding.ts`) with
// zero runtime Three.js imports.

import { cityStyleFor, normalizeCityStyle, type CityStyle } from '../sim/cityStyles.ts'
import { drawMetroMark } from '../render/cityBranding.ts'
import { drawChengduLogo } from '../render/chengduBranding.ts'
import { drawBeijingTrainMark } from '../render/beijingTrainMark.ts'
import { drawNanjingLogo } from '../render/nanjingBranding.ts'
import { drawChongqingTrainBadge } from '../render/chongqingBranding.ts'
import { SIGN_FACE_CHUNK_CHARS } from './signFaceProvider.ts'
import { stationBridge } from './stationBridge.ts'

export interface TrainMarkRequestItem {
  key: string
  kind: 'city' | 'chongqing' | 'nanjing'
  city: string
  lineId?: string
  colour?: string
}

export interface TrainMarkRequestEnvelope {
  schemaVersion?: number
  kind?: string
  type?: string
  id?: string
  sessionId?: string
  revision?: number
  payload?: {
    requestId?: string
    marks?: TrainMarkRequestItem[]
  }
}

export interface TrainMarkPort {
  receive(message: unknown): boolean
  dispose(): void
}

function parseMessage(message: unknown): TrainMarkRequestEnvelope | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message)
      return parsed && typeof parsed === 'object' ? parsed as TrainMarkRequestEnvelope : null
    } catch {
      return null
    }
  }
  if (message && typeof message === 'object') return message as TrainMarkRequestEnvelope
  return null
}

export function isTrainMarkRequest(message: unknown): boolean {
  const env = parseMessage(message)
  if (!env) return false
  return env.kind === 'trainMarkRequest' || env.type === 'train.requestMark'
}

export function paintTrainMarkCanvas(item: TrainMarkRequestItem): { width: number; height: number; pngBase64: string } | null {
  if (typeof document === 'undefined') return null
  const city: CityStyle = normalizeCityStyle(item.city)
  const style = cityStyleFor(city)
  const canvas = document.createElement('canvas')
  if (item.kind === 'chongqing') {
    canvas.width = 512
    canvas.height = 128
  } else if (item.kind === 'nanjing') {
    canvas.width = 256
    canvas.height = 256
  } else {
    canvas.width = 384
    canvas.height = 150
  }
  const g = canvas.getContext('2d')
  if (!g) return null
  g.clearRect(0, 0, canvas.width, canvas.height)

  if (item.kind === 'chongqing') {
    if (city === 'chongqing') {
      drawChongqingTrainBadge(g, item.lineId ?? '1', item.colour ?? '#2f7ef2', canvas.width, canvas.height)
    }
  } else if (item.kind === 'nanjing') {
    if (city === 'nanjing') {
      drawNanjingLogo(g, canvas.width / 2, canvas.height / 2, canvas.height - 12)
    }
  } else {
    const slotW = 128
    if (style.logo === 'chongqing' || style.logo === 'nanjing') {
      // Shared 3-slot atlas stays transparent.
    } else if (style.logo === 'chengdu') {
      drawChengduLogo(g, canvas.width - slotW / 2, canvas.height / 2, slotW - 10)
    } else if (style.trainMark === 'beijing-calligraphy') {
      drawBeijingTrainMark(g, slotW * 1.5, canvas.height / 2, slotW - 8, style.trainMarkColour)
    } else {
      const dim = (style.logo === 'shanghai' || style.logo === 'wuhan' ? Math.min(slotW, canvas.height) : canvas.height) - 10
      drawMetroMark(g, slotW / 2, canvas.height / 2, dim, style.logoColour, city)
    }
  }

  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  const pngBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
  return { width: canvas.width, height: canvas.height, pngBase64 }
}

export function createTrainMarkPort(
  send: (type: string, payload: Record<string, unknown>) => void = (t, p) => { stationBridge.send(t, p) },
  paint: (item: TrainMarkRequestItem) => { width: number; height: number; pngBase64: string } | null = paintTrainMarkCanvas,
): TrainMarkPort {
  let disposed = false
  return {
    receive(message: unknown): boolean {
      if (disposed || !isTrainMarkRequest(message)) return false
      const env = parseMessage(message)
      const marks = env?.payload?.marks
      if (!Array.isArray(marks) || marks.length === 0) return true
      const ready: Array<{ key: string; width: number; height: number }> = []
      for (const item of marks) {
        if (!item || typeof item.key !== 'string' || item.key.length === 0) continue
        const painted = paint(item)
        if (!painted || !painted.pngBase64) continue
        const b64 = painted.pngBase64
        let idx = 0
        for (let off = 0; off < b64.length; off += SIGN_FACE_CHUNK_CHARS) {
          send('train.markChunk', {
            key: item.key,
            index: idx++,
            data: b64.slice(off, off + SIGN_FACE_CHUNK_CHARS),
          })
        }
        ready.push({ key: item.key, width: painted.width, height: painted.height })
      }
      send('train.markReady', {
        requestId: env?.payload?.requestId ?? '',
        marks: ready,
      })
      return true
    },
    dispose(): void {
      disposed = true
    },
  }
}
