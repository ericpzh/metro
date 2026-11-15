// Street exit and guidepost plates across the plan-11 bridge (plan 16 §5.3).
//
// The source prints an exit head-house's fascia from the committed station identity
// (`exitHeaderCanvas`: metro mark, station name/nameEn, the exit's own `cfg.name` and,
// per city, the line badges) and a 导向柱's station face + exit letter from
// `guideLabels` / `guideFace` / `guideEnglishFace` / `guideExitLetterFace`. The promoted
// Unity prefabs bake those plates from the **empty review station** (the visible
// placeholder in the screenshots), so C# finds each baked plate node and asks this module
// to paint the committed one.
//
// This file is the Unity **reach**, not a second painter: it composes the source's own
// canvases onto a canvas of the plate's pixel size and returns the PNG in bounded chunks.
// The upstream functions are untouched, so a fresh WebGL player prints the same artwork
// as the TypeScript game.
//
//   C# → TS  `{ schemaVersion: 2, kind: 'exitFaceRequest', id, sessionId, revision,
//               payload: { requestId, locale, faces: ExitFaceFacts[] } }`
//   TS → C#  `exit.faceChunk` (bounded `data` base64 slices, one key) and
//            `exit.faceReady` (painted metadata + ink, and any face still pending)
//   TS → C#  `exit.locale` (session-scoped notice: the shell's print language changed)

import { exitHeaderCanvas } from '../render/models/pieces/ExitModel.ts'
import { exitHeaderResolution } from '../render/exitHeaderResolution.ts'
import { guideEnglishFace, guideExitLetterFace, guideFace, guideLabels } from '../render/models/pieces/StreetDecorModel.ts'
import type { CityStyle } from '../sim/cityStyles.ts'
import { getLanguage, setLanguage, subscribeLanguage, t, type Language } from '../sim/i18n.ts'
import type { Module, StationData } from '../sim/types.ts'
import { defaultEnsureFonts, SIGN_FACE_CHUNK_CHARS } from './signFaceProvider.ts'
import { stationBridge } from './stationBridge.ts'

/* ------------------------------------------------------------------ shapes */

export type ExitFacePainter = 'exitHeader' | 'guideStationUpper' | 'guideStationRear' | 'guideExitLetter'

/** One line fact an exit fascia prints. Only what the per-city headers read. */
export interface ExitFaceLineFacts {
  id: string
  name: string
  nameEn?: string
  colour: string
}

/** One printed plate C# asks for. Everything here is painted data or the plate's size. */
export interface ExitFaceFacts {
  /** Opaque content key minted by C#; echoed in the reply so the cache can match it. */
  key: string
  /** The saved street module that carries the plate, for diagnostics. */
  moduleId: string
  /** `exit` for a head-house fascia; `guidepost` for the pillar's plates. */
  recordType?: 'exit' | 'guidepost'
  /** Saved exit style (`doorway` scales header width at constant pixel density like `DoorwayExitModel`). */
  style?: string
  painter: ExitFacePainter
  /** Target canvas width/height for a guidepost plate; 0 for an exit fascia. */
  pixels: number
  pixelsHigh: number
  /** The printed plate in source metres (the quad's size, not the picture). */
  width: number
  height: number
  station: string
  stationEn: string
  /** City style id (`guangzhou`, `shenzhen`, …); unknown ids fall back like `cityStyleFor`. */
  city: string
  /** The exit's saved `cfg.name` (raw). Empty falls back inside the painter. */
  exitName: string
  /** The exit a guidepost links to by `cfg.exitId`. */
  exitId?: string
  /** False when the link names no saved exit (the source's `t('entrance')` branch). */
  exitFound?: boolean
  lines?: ExitFaceLineFacts[]
  /** The print locale C# believes; the shell's own language wins when omitted. */
  locale?: string
}

export interface PaintedExitFace {
  key: string
  moduleId: string
  painter: ExitFacePainter
  width: number
  height: number
  /** Fraction of marked pixels; a blank plate can never pass as artwork. */
  ink: number
  locale: Language
  pngBase64: string
}

export interface PendingExitFace {
  key: string
  moduleId: string
  painter: ExitFacePainter
  /** Why no pixels yet. `empty`/`unsupported` are final; `font` is retried by C#. */
  reason: 'font' | 'unsupported' | 'empty'
  detail?: string
}

/** A canvas the painter can draw into. Injectable so a fixture can paint the same plate. */
export interface ExitFaceSurface {
  readonly width: number
  readonly height: number
  readonly context: CanvasRenderingContext2D
  pngBase64(): string | null
}

export type ExitFaceSurfaceFactory = (width: number, height: number) => ExitFaceSurface | null

export interface ExitFacePort {
  /** Paint the plates in one `exitFaceRequest`. Returns false for any other message. */
  receive(message: unknown): boolean
  /** Paint one plate now; exposed for fixtures and for the shell's own previews. */
  paint(facts: ExitFaceFacts): PaintedExitFace | PendingExitFace
  /** Resolves when every request received so far has been answered. */
  whenIdle(): Promise<void>
  /** Bytes per `exit.faceChunk` slice (base64 characters). */
  readonly chunkSize: number
  dispose(): void
}

export interface ExitFacePortOptions {
  /** Transport for `exit.faceChunk` / `exit.faceReady` / `exit.locale`. */
  send?: (type: string, payload: unknown) => string | void
  /** Where the painter draws. Defaults to a DOM canvas. */
  createSurface?: ExitFaceSurfaceFactory
  /** Font readiness; resolves false when the browser cannot offer the CJK face yet. */
  ensureFonts?: () => Promise<boolean>
  chunkSize?: number
  /** How long a font wait may take before the plate is reported pending. */
  fontReadyTimeoutMs?: number
  /** The locale the shell is showing, used when a plate names none. */
  locale?: () => Language
}

/* --------------------------------------------------------------- messaging */

/** How many plates one C# request may carry, so one message stays small. */
export const EXIT_FACE_REQUEST_MAX = 32

/** The promoted guidepost plates' own canvas sizes (the export's textures). */
export const GUIDE_FACE_PIXELS = { stationUpper: [256, 277], stationRear: [256, 993], exitLetter: [256, 256] } as const

interface ExitFaceRequestEnvelope {
  schemaVersion?: number
  kind?: string
  type?: string
  id?: string
  sessionId?: string
  revision?: number
  payload?: { requestId?: unknown; revision?: unknown; sessionId?: unknown; locale?: unknown; faces?: unknown }
}

function parseMessage(message: unknown): ExitFaceRequestEnvelope | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown
      return parsed && typeof parsed === 'object' ? parsed as ExitFaceRequestEnvelope : null
    } catch {
      return null
    }
  }
  if (message && typeof message === 'object') return message as ExitFaceRequestEnvelope
  return null
}

/** True for the one message shape this port answers. */
export function isExitFaceRequest(message: unknown): boolean {
  const envelope = parseMessage(message)
  if (!envelope) return false
  return envelope.kind === 'exitFaceRequest' || envelope.type === 'exit.requestFace'
}

/* ---------------------------------------------------------------- painting */

/** A canvas surface over the DOM, or null outside a browser. */
export function domExitFaceSurface(width: number, height: number): ExitFaceSurface | null {
  const documentRef = (globalThis as { document?: Document }).document
  if (!documentRef || typeof documentRef.createElement !== 'function') return null
  const canvas = documentRef.createElement('canvas')
  if (!canvas || typeof canvas.getContext !== 'function') return null
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  return {
    width,
    height,
    context,
    pngBase64() {
      if (typeof canvas.toDataURL !== 'function') return null
      const url = canvas.toDataURL('image/png')
      const comma = url.indexOf(',')
      return comma < 0 ? null : url.slice(comma + 1)
    },
  }
}

/** Normalize a locale a plate asks for into the sim's own type. */
export function exitFaceLocale(value: unknown, fallback: Language = 'zh-CN'): Language {
  return value === 'en' || value === 'zh-CN' ? value : fallback
}

/**
 * The exit label a guidepost prints, through the **source's own** `guideLabels`: the
 * synthetic exit carries the C#-resolved `cfg.name` and the synthetic guidepost its
 * `cfg.exitId`, so the suffix strip and the `t('entrance')` fallback are the shipping
 * rules rather than a copy of them.
 */
export function guideExitLabel(facts: ExitFaceFacts): string {
  const linked = facts.exitFound !== false
  const modules = linked
    ? [{
        type: 'exit',
        id: facts.exitId || facts.exitName || 'exit',
        cfg: { name: facts.exitName || '' },
      }] as unknown as Module[]
    : []
  const guidepost = { type: 'guidepost', cfg: { exitId: facts.exitId || '' } } as unknown as Extract<Module, { type: 'guidepost' }>
  return guideLabels({ name: facts.station || '', modules }, guidepost).exit
}

/** Fraction of marked pixels: non-transparent coverage, or non-ground for an opaque plate. */
function inkOf(context: CanvasRenderingContext2D, width: number, height: number): number {
  try {
    if (typeof context.getImageData !== 'function') return -1
    const data = context.getImageData(0, 0, width, height).data
    if (data.length < 4) return 0
    const ground = [data[0], data[1], data[2], data[3]]
    let ink = 0
    for (let i = 0; i < data.length; i += 4) {
      if (ground[3] <= 16) {
        if (data[i + 3] > 16) ink++
      } else if (data[i] !== ground[0] || data[i + 1] !== ground[1] || data[i + 2] !== ground[2] || data[i + 3] !== ground[3]) {
        ink++
      }
    }
    return ink / (width * height)
  } catch {
    return -1
  }
}

function painterOf(value: unknown): ExitFacePainter {
  return value === 'guideStationUpper' || value === 'guideStationRear' || value === 'guideExitLetter' ? value : 'exitHeader'
}

/**
 * Paint one plate with the shipping engines.
 *
 * The exit fascia is the source's own per-city canvas at its own resolution
 * (`exitHeaderResolution`), so a Chengdu fascia is the source's 2048 × 384 print rather
 * than a stretched lowercase copy. A guidepost plate is painted at the promoted
 * material's texture size; the station upper face reuses the source's top-of-canvas crop
 * (`guideFace`'s 256 × 277 window) scaled to the plate, and the rear/letter faces scale
 * their own square/tall canvases to it.
 *
 * The global language is switched to the plate's locale for the draw (the source's `t()`
 * strings are read there) and restored afterwards, exactly as `signFaceProvider` does.
 */
export function paintExitFace(
  facts: ExitFaceFacts,
  options: { createSurface?: ExitFaceSurfaceFactory } = {},
): PaintedExitFace | PendingExitFace {
  if (!facts || typeof facts.key !== 'string' || facts.key.length === 0) {
    return { key: facts?.key ?? '', moduleId: facts?.moduleId ?? '', painter: painterOf(facts?.painter), reason: 'unsupported', detail: 'key' }
  }
  const painter = painterOf(facts.painter)
  const createSurface = options.createSurface ?? domExitFaceSurface
  const locale = exitFaceLocale(facts.locale, getLanguage())
  const city = (facts.city || undefined) as CityStyle | undefined
  const previous = getLanguage()
  const switched = locale !== previous
  if (switched) setLanguage(locale)
  try {
    let width: number
    let height: number
    const baseWidth = painter === 'exitHeader' && facts.style === 'doorway' && facts.width > 0
      ? Math.max(512, Math.round(512 * facts.width / 2.88))
      : 512
    if (painter === 'exitHeader') {
      const resolution = exitHeaderResolution(baseWidth, city)
      width = resolution.width
      height = resolution.height
    } else {
      if (!(facts.pixels > 0) || !(facts.pixelsHigh > 0)) {
        return { key: facts.key, moduleId: facts.moduleId, painter, reason: 'unsupported', detail: 'pixels' }
      }
      width = Math.round(facts.pixels)
      height = Math.round(facts.pixelsHigh)
    }
    const surface = createSurface(width, height)
    if (!surface) return { key: facts.key, moduleId: facts.moduleId, painter, reason: 'unsupported', detail: 'canvas' }
    const context = surface.context
    if (typeof context.clearRect === 'function') context.clearRect(0, 0, surface.width, surface.height)
    if (painter === 'exitHeader') {
      const lines = Array.isArray(facts.lines) ? facts.lines : []
      const header = exitHeaderCanvas(
        facts.station || '',
        facts.exitName || '',
        facts.stationEn || '',
        baseWidth,
        { cityStyle: city, lines } as Partial<Pick<StationData, 'cityStyle' | 'lines'>>,
        surface.width / baseWidth,
      )
      context.drawImage(header, 0, 0, surface.width, surface.height)
    } else {
      const label = guideExitLabel(facts)
      if (painter === 'guideStationUpper') {
        // The source crops the top 256 × 277 window of the tall station canvas and mounts
        // it on the upper plate; scale that same window to the plate's own pixels.
        const ink = guideFace(facts.station || '', label)
        const crop = Math.max(1, Math.min(ink.height, Math.round(ink.width * surface.height / surface.width)))
        context.drawImage(ink, 0, 0, ink.width, crop, 0, 0, surface.width, surface.height)
      } else if (painter === 'guideStationRear') {
        // The rear English face reads downwards; `guideEnglishFace` owns that rotation.
        const ink = guideEnglishFace(facts.stationEn?.trim() || t('printed_metro_station'))
        context.drawImage(ink, 0, 0, ink.width, ink.height, 0, 0, surface.width, surface.height)
      } else {
        const ink = guideExitLetterFace(label)
        context.drawImage(ink, 0, 0, ink.width, ink.height, 0, 0, surface.width, surface.height)
      }
    }
    const png = surface.pngBase64()
    if (!png) return { key: facts.key, moduleId: facts.moduleId, painter, reason: 'unsupported', detail: 'encode' }
    return {
      key: facts.key,
      moduleId: facts.moduleId,
      painter,
      width: surface.width,
      height: surface.height,
      ink: inkOf(context, surface.width, surface.height),
      locale,
      pngBase64: png,
    }
  } finally {
    if (switched) setLanguage(previous)
  }
}

/* --------------------------------------------------------------------- port */

function pendingOf(facts: ExitFaceFacts, reason: PendingExitFace['reason'], detail?: string): PendingExitFace {
  return { key: facts.key, moduleId: facts.moduleId, painter: painterOf(facts.painter), reason, ...(detail ? { detail } : {}) }
}

function factsOf(value: unknown): ExitFaceFacts | null {
  if (!value || typeof value !== 'object') return null
  const facts = value as Partial<ExitFaceFacts>
  if (typeof facts.key !== 'string' || facts.key.length === 0) return null
  const pixels = Number(facts.pixels)
  const pixelsHigh = Number(facts.pixelsHigh)
  const width = Number(facts.width)
  const height = Number(facts.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  const lines = Array.isArray(facts.lines)
    ? facts.lines
        .filter((line): line is ExitFaceLineFacts => !!line && typeof line === 'object' && typeof line.id === 'string')
        .slice(0, 32)
        .map(line => ({ id: line.id, name: typeof line.name === 'string' ? line.name : '', nameEn: typeof line.nameEn === 'string' ? line.nameEn : '', colour: typeof line.colour === 'string' ? line.colour : '' }))
    : []
  return {
    key: facts.key,
    moduleId: typeof facts.moduleId === 'string' ? facts.moduleId : '',
    recordType: facts.recordType === 'guidepost' ? 'guidepost' : 'exit',
    ...(typeof facts.style === 'string' && facts.style.length > 0 ? { style: facts.style } : {}),
    painter: painterOf(facts.painter),
    pixels: Number.isFinite(pixels) ? Math.round(pixels) : 0,
    pixelsHigh: Number.isFinite(pixelsHigh) ? Math.round(pixelsHigh) : 0,
    width,
    height,
    station: typeof facts.station === 'string' ? facts.station : '',
    stationEn: typeof facts.stationEn === 'string' ? facts.stationEn : '',
    city: typeof facts.city === 'string' ? facts.city : '',
    exitName: typeof facts.exitName === 'string' ? facts.exitName : '',
    exitId: typeof facts.exitId === 'string' ? facts.exitId : '',
    exitFound: facts.exitFound !== false,
    lines,
    locale: typeof facts.locale === 'string' ? facts.locale : undefined,
  }
}

/**
 * Build the port the Unity shell registers next to `createSignFacePort` and
 * `createPsdHeaderPort`.
 *
 * `receive` answers only `exitFaceRequest` messages (true for those, false otherwise), so
 * the shell can offer every C# message to it before the state reducer and a PNG never
 * enters the document reducer. The port also reports the shell's print language to C#
 * (`exit.locale`) so a language switch re-keys and repaints the street plates; the
 * notice is deferred one microtask so a provider's temporary `setLanguage` (the sign
 * painter's own) can never masquerade as a user switch.
 */
export function createExitFacePort(options: ExitFacePortOptions = {}): ExitFacePort {
  const send = options.send ?? ((type: string, payload: unknown) => { stationBridge.send(type, payload); return '' })
  const chunkSize = Math.max(1024, Math.floor(options.chunkSize ?? SIGN_FACE_CHUNK_CHARS))
  const createSurface = options.createSurface ?? domExitFaceSurface
  const ensureFonts = options.ensureFonts ?? (() => defaultEnsureFonts(options.fontReadyTimeoutMs))
  const shellLocale = options.locale ?? getLanguage
  let disposed = false
  let work: Promise<void> = Promise.resolve()
  let notifiedLocale: Language | null = null

  const notifyLocale = (locale: Language): void => {
    if (locale === notifiedLocale) return
    notifiedLocale = locale
    send('exit.locale', { locale })
  }
  // The source painters switch the global language while they draw; notify after the
  // current task so only a real shell switch is reported.
  const scheduleLocale = (): void => { queueMicrotask(() => notifyLocale(shellLocale())) }
  const unsubscribeLanguage = subscribeLanguage(scheduleLocale)
  notifyLocale(shellLocale())

  const paintPlate = (facts: ExitFaceFacts): PaintedExitFace | PendingExitFace => {
    try {
      return paintExitFace(facts, { createSurface })
    } catch (error) {
      return pendingOf(facts, 'unsupported', error instanceof Error ? error.message : 'paint')
    }
  }

  /** One chunked reply per painted plate. */
  const sendPlate = (requestId: string, revision: number, sessionId: string, painted: PaintedExitFace[]): void => {
    for (const face of painted) {
      const count = Math.max(1, Math.ceil(face.pngBase64.length / chunkSize))
      for (let index = 0; index < count; index++) {
        const data = face.pngBase64.slice(index * chunkSize, (index + 1) * chunkSize)
        send('exit.faceChunk', {
          requestId,
          revision,
          sessionId,
          key: face.key,
          moduleId: face.moduleId,
          painter: face.painter,
          width: face.width,
          height: face.height,
          locale: face.locale,
          index,
          count,
          data,
        })
      }
    }
  }

  const readyPayload = (
    requestId: string,
    revision: number,
    sessionId: string,
    painted: PaintedExitFace[],
    pending: PendingExitFace[],
    artReady: boolean,
  ): Record<string, unknown> => ({
    requestId,
    revision,
    sessionId,
    artReady,
    painted: painted.map(face => ({
      key: face.key,
      moduleId: face.moduleId,
      painter: face.painter,
      width: face.width,
      height: face.height,
      ink: face.ink,
      locale: face.locale,
      bytes: Math.floor(face.pngBase64.length * 3 / 4) - (face.pngBase64.endsWith('==') ? 2 : face.pngBase64.endsWith('=') ? 1 : 0),
      chunks: Math.max(1, Math.ceil(face.pngBase64.length / chunkSize)),
    })),
    pending: pending.map(face => ({
      key: face.key,
      moduleId: face.moduleId,
      painter: face.painter,
      reason: face.reason,
      ...(face.detail ? { detail: face.detail } : {}),
    })),
  })

  const answer = async (requestId: string, revision: number, sessionId: string, faces: ExitFaceFacts[]): Promise<void> => {
    // Every plate prints type (the station and exit words are always drawn), so a canvas
    // painted before the CJK face lands would keep a fallback glyph for the session.
    if (faces.length > 0) {
      const fonts = await ensureFonts()
      if (!fonts) {
        const pending = faces.map(face => pendingOf(face, 'font'))
        send('exit.faceReady', readyPayload(requestId, revision, sessionId, [], pending, false))
        return
      }
    }
    const painted: PaintedExitFace[] = []
    const pending: PendingExitFace[] = []
    for (const face of faces) {
      const result = paintPlate(face)
      if ('reason' in result) pending.push(result)
      else painted.push(result)
    }
    sendPlate(requestId, revision, sessionId, painted)
    send('exit.faceReady', readyPayload(requestId, revision, sessionId, painted, pending, true))
  }

  const handle = (message: unknown): boolean => {
    if (!isExitFaceRequest(message)) return false
    const envelope = parseMessage(message) as ExitFaceRequestEnvelope
    const payload = envelope.payload ?? {}
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : (envelope.id ?? '')
    // The two upper station faces share one key; paint it once and answer once.
    const unique = new Map<string, ExitFaceFacts>()
    const rawFaces = Array.isArray(payload.faces) ? payload.faces : []
    for (const raw of rawFaces.slice(0, EXIT_FACE_REQUEST_MAX * 4)) {
      const face = factsOf(raw)
      if (face && !unique.has(face.key)) unique.set(face.key, face)
    }
    const faces = [...unique.values()]
    if (requestId.length === 0 || faces.length === 0) return true
    const revision = typeof envelope.revision === 'number' ? envelope.revision : (typeof payload.revision === 'number' ? payload.revision : -1)
    const sessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId : (typeof payload.sessionId === 'string' ? payload.sessionId : '')
    if (disposed) return true
    work = work.then(() => answer(requestId, revision, sessionId, faces)).catch(() => {
      // A painter failure must still release the request, or C# would wait forever.
      send('exit.faceReady', readyPayload(requestId, revision, sessionId, [], faces.map(face => pendingOf(face, 'unsupported', 'exception')), false))
    })
    return true
  }

  return {
    receive: handle,
    paint(facts: ExitFaceFacts) {
      return paintPlate(factsOf(facts) ?? facts)
    },
    whenIdle: () => work,
    chunkSize,
    dispose() {
      disposed = true
      unsubscribeLanguage()
    },
  }
}
