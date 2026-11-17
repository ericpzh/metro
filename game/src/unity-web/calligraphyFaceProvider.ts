// Station-name inscriptions across the plan-11/30 bridge: C# asks, the shipping
// painter paints.
//
// Unity owns the plate, its mesh, its UVs and its instance material. The 站名's
// pixels stay in this codebase: `render/calligraphyFace.ts` is the only drawing code
// for an inscription (the game's plate system, the palette thumbnail and the tests all
// call `drawCalligraphyPanel`), and `sim/calligraphyFonts.ts` is the only table of
// approved hands. This module is the Unity **reach** for them: it takes a normalised
// panel from C#, paints it at `PX_PER_METRE` on a transparent canvas through
// `drawCalligraphyPanel`, applies the Unity plate's measured UV orientation, and
// returns the PNG in bounded base64 slices.
//
// It deliberately owns no layout and no font table: the panel's metres and the hand
// come from `sim/calligraphy.ts` / `sim/calligraphyFonts.ts`, so the inscription Unity
// shows is the inscription the browser shows. A second painter here would be a second
// engine, and the two would drift apart again (which is the defect this path fixes:
// Unity used one `NotoSansSC.ttf` for all six hands).
//
// Contract (a distinct request kind, sharing the v2 envelope, the 48 KiB slice and
// the session/revision fence with sign faces, PSD headers and exit plates):
//
//   C# → TS  `{ schemaVersion: 2, kind: 'calligraphyRequest', id, sessionId, revision,
//               payload: { requestId, locale, faces: CalligraphyFaceFacts[] } }`
//   TS → C#  `calligraphy.faceChunk` (bounded `data` base64 slices, one key) and
//            `calligraphy.faceReady` (painted metadata — resolved face, missing-face
//            verdict — and the faces still pending)
//
// A face painted before the browser's font set has settled would keep a fallback
// glyph for the session, so a request that arrives too early is answered with a
// **pending** record (`reason: 'font'`) and no pixels, and C# asks again.

import {
  CALLIGRAPHY_FONT_VERSION,
  calligraphyFontFace,
  describeCalligraphyResolution,
  resolveCalligraphyFace,
  type CalligraphyFaceProbe,
  type CalligraphyFaceProbeResult,
  type CalligraphyFaceResolution,
} from '../sim/calligraphyFonts.ts'
import { isCalligraphyAxis, isCalligraphyStyle } from '../sim/calligraphy.ts'
import { PX_PER_METRE, calligraphyPlate, drawCalligraphyPanel } from '../render/calligraphyFace.ts'
import type { CalligraphyAxis, CalligraphyStyle } from '../sim/types.ts'
import { getLanguage, setLanguage, type Language } from '../sim/i18n.ts'
import { defaultEnsureFonts, SIGN_FACE_CHUNK_CHARS } from './signFaceProvider.ts'
import { stationBridge } from './stationBridge.ts'

/* ------------------------------------------------------------------ shapes */

/** One inscription C# wants painted: the committed text on the plate it was cut for. */
export interface CalligraphyFaceFacts {
  /** Opaque content key minted by C# (text, hand, axis, panel, orientation, manifest); echoed in the reply. */
  key: string
  /** The saved module that carries the plate, for diagnostics. */
  moduleId: string
  /** The station's name, exactly as the document spells it. */
  text: string
  /** The station's English name; printed only when `showEnglish`. */
  english: string
  /** The hand (`CALLIGRAPHY_STYLES`). An unknown/legacy value is 楷书, like `calligraphyStyle`. */
  style: CalligraphyStyle
  /** 横排 (`h`) across the panel, 竖排 (`v`) down it. An unknown value is 横排. */
  axis: CalligraphyAxis
  /** The panel's size in metres (`calligraphyPanelSize`). */
  w: number
  h: number
  /** Whether the English name is printed beside the run (the module's `cfg.showEnglish`). */
  showEnglish: boolean
  /** The Unity plate's measured U mirror (its UVs run right-to-left). */
  mirrorU: boolean
  /** The Unity plate's measured V flip (glTFast imports `1 − V`). */
  flipV: boolean
  /** Requested locale; the shell's own when omitted. */
  locale?: string
}

/** The whole C# request: one station build's inscriptions, already bounded by C#. */
export interface CalligraphyFaceRequestFacts {
  requestId: string
  revision: number
  sessionId: string
  locale?: string
  faces: CalligraphyFaceFacts[]
}

export interface PaintedCalligraphyFace {
  key: string
  moduleId: string
  style: CalligraphyStyle
  axis: CalligraphyAxis
  width: number
  height: number
  locale: Language
  /** Which approved face actually painted, and whether any was present. */
  resolution: CalligraphyFaceResolution
  /** PNG bytes, base64. Sent in `calligraphy.faceChunk` slices, never whole. */
  pngBase64: string
}

export interface PendingCalligraphyFace {
  key: string
  moduleId: string
  style: CalligraphyStyle
  axis: CalligraphyAxis
  /**
   * Why no pixels yet. `font` is retried by C# after the retry window;
   * `unsupported` is final. `empty` is reserved — a blank name prints the source's
   * `unknown` marker rather than an empty plate.
   */
  reason: 'font' | 'unsupported' | 'empty'
  detail?: string
}

/**
 * A canvas the painter can draw into. Injectable so a fixture can paint the same
 * plate without a browser. `image` is the surface's own drawable: the orientation
 * copy needs it, because a mirrored/flipped plate is composed onto a second surface
 * before it is encoded.
 */
export interface CalligraphyFaceSurface {
  readonly width: number
  readonly height: number
  readonly context: CanvasRenderingContext2D
  readonly image?: CanvasImageSource
  /** The encoded PNG as base64, or null when this surface cannot encode. */
  pngBase64(): string | null
}

export type CalligraphyFaceSurfaceFactory = (width: number, height: number) => CalligraphyFaceSurface | null

/** The port the Unity shell holds. `receive` is called for every C# → TS message. */
export interface CalligraphyFacePort {
  /** Paint the faces in one `calligraphyRequest`. Returns false for any other message. */
  receive(message: unknown): boolean
  /** Paint one face now; exposed for fixtures and for the shell's own previews. */
  paint(face: CalligraphyFaceFacts, locale?: Language): Promise<PaintedCalligraphyFace | PendingCalligraphyFace>
  /** Resolves when every request received so far has been answered. */
  whenIdle(): Promise<void>
  /** Base64 characters per `calligraphy.faceChunk` slice. */
  readonly chunkSize: number
  /** The manifest version this shell paints under (echoed in `calligraphy.faceReady`). */
  readonly fontVersion: string
  dispose(): void
}

export interface CalligraphyFacePortOptions {
  /** Transport for `calligraphy.faceChunk` / `calligraphy.faceReady`. Defaults to `stationBridge.send`. */
  send?: (type: string, payload: unknown) => string | void
  /** Where the painter draws. Defaults to a DOM canvas. */
  createSurface?: CalligraphyFaceSurfaceFactory
  /** Font readiness; resolves false when the browser cannot offer its faces yet. */
  ensureFonts?: () => Promise<boolean>
  /** Face presence probe; defaults to `document.fonts.check` plus an advance measurement. */
  probeFonts?: CalligraphyFaceProbe
  /** The locale the shell is showing, used when a face names none. */
  locale?: () => Language
  chunkSize?: number
  /** How long a font wait may take before the faces are reported pending. */
  fontReadyTimeoutMs?: number
}

/* --------------------------------------------------------------- messaging */

/** How much base64 one `calligraphy.faceChunk` carries — the shared 48 KiB slice. */
export const CALLIGRAPHY_FACE_CHUNK_CHARS = SIGN_FACE_CHUNK_CHARS

/** How many faces one C# request may carry, so one message stays small. */
export const CALLIGRAPHY_FACE_REQUEST_MAX = 32

interface CalligraphyRequestEnvelope {
  schemaVersion?: number
  kind?: string
  type?: string
  id?: string
  sessionId?: string
  revision?: number
  payload?: {
    requestId?: unknown
    revision?: unknown
    sessionId?: unknown
    locale?: unknown
    faces?: unknown
  }
}

function parseMessage(message: unknown): CalligraphyRequestEnvelope | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown
      return parsed && typeof parsed === 'object' ? parsed as CalligraphyRequestEnvelope : null
    } catch {
      return null
    }
  }
  if (message && typeof message === 'object') return message as CalligraphyRequestEnvelope
  return null
}

/** True for the one message shape this port answers. */
export function isCalligraphyRequest(message: unknown): boolean {
  const envelope = parseMessage(message)
  if (!envelope) return false
  return envelope.kind === 'calligraphyRequest' || envelope.type === 'calligraphy.requestFace'
}

/* ---------------------------------------------------------------- painting */

/** A canvas surface over the DOM, or null outside a browser. */
export function domCalligraphyFaceSurface(width: number, height: number): CalligraphyFaceSurface | null {
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
    image: canvas,
    pngBase64() {
      if (typeof canvas.toDataURL !== 'function') return null
      const url = canvas.toDataURL('image/png')
      const comma = url.indexOf(',')
      return comma < 0 ? null : url.slice(comma + 1)
    },
  }
}

/** Normalize the locale a face asks for into the sim's own type. */
export function calligraphyFaceLocale(value: unknown, fallback: Language = 'zh-CN'): Language {
  if (value === 'en') return 'en'
  if (value === 'zh-CN' || value === 'zh' || value === 'zh_CN') return 'zh-CN'
  return fallback
}

/**
 * Compose the painted plate onto a second surface when the Unity plate's measured
 * UVs need it. The canvas transform is the PNG's own orientation: a U mirror is a
 * horizontal flip, a V flip turns the picture over, and both are applied exactly
 * once — the same two bits `StationCalligraphyArtwork` measured on the authored mesh.
 *
 * A surface without a drawable cannot be oriented; that is reported (`unsupported`)
 * rather than silently shipping unmirrored pixels onto a mirrored plate.
 */
function orientCalligraphySurface(
  source: CalligraphyFaceSurface,
  mirrorU: boolean,
  flipV: boolean,
  createSurface: CalligraphyFaceSurfaceFactory,
): CalligraphyFaceSurface | null {
  if (!mirrorU && !flipV) return source
  const image = source.image
  if (!image) return null
  const target = createSurface(source.width, source.height)
  if (!target) return null
  const context = target.context
  if (typeof context.clearRect === 'function') context.clearRect(0, 0, target.width, target.height)
  context.translate(mirrorU ? source.width : 0, flipV ? source.height : 0)
  context.scale(mirrorU ? -1 : 1, flipV ? -1 : 1)
  context.drawImage(image, 0, 0)
  return target
}

/**
 * Paint one inscription with the shipping engine.
 *
 * The plate is `calligraphyPlate(panel)` — `PX_PER_METRE` pixels per metre, the
 * model's own texture size — and the draw is `drawCalligraphyPanel` with the same
 * options the web scene passes (`PlateSystem`): the station's name, the English name
 * only when the module opts in, the hand and the axis. Nothing here re-derives the
 * layout. The ground is transparent (a fresh canvas; cleared defensively) because the
 * wall behind the piece is the inscription's paper.
 *
 * The face probe runs after the fonts have settled and records which approved family
 * the paint could prove. A hand none of whose families is present still paints —
 * with the deliberate last resort — and the record says `missing`, so C# can put it
 * in its ledger instead of a substitution going unnoticed.
 */
export function paintCalligraphyFace(
  face: CalligraphyFaceFacts,
  options: {
    createSurface?: CalligraphyFaceSurfaceFactory
    locale?: Language
    probe?: CalligraphyFaceProbe
  } = {},
): PaintedCalligraphyFace | PendingCalligraphyFace {
  const panel = { w: face.w, h: face.h }
  if (!Number.isFinite(panel.w) || !Number.isFinite(panel.h) || panel.w <= 0 || panel.h <= 0) {
    return pendingOf(face, 'unsupported', 'panel')
  }
  const plate = calligraphyPlate(panel)
  const createSurface = options.createSurface ?? domCalligraphyFaceSurface
  const surface = createSurface(plate.width, plate.height)
  if (!surface) return pendingOf(face, 'unsupported', 'canvas')
  const context = surface.context
  if (typeof context.clearRect === 'function') context.clearRect(0, 0, surface.width, surface.height)
  const locale = calligraphyFaceLocale(face.locale, options.locale ?? getLanguage())
  const previous = getLanguage()
  const switched = locale !== previous
  if (switched) setLanguage(locale)
  try {
    drawCalligraphyPanel(context, {
      text: face.text,
      english: face.showEnglish ? face.english : undefined,
      style: face.style,
      axis: face.axis,
      panel,
      ppm: PX_PER_METRE,
    })
  } finally {
    if (switched) setLanguage(previous)
  }
  const resolution = resolveCalligraphyFace(face.style, options.probe ?? createDomCalligraphyFaceProbe())
  const oriented = orientCalligraphySurface(surface, face.mirrorU, face.flipV, createSurface)
  if (!oriented) return pendingOf(face, 'unsupported', 'orientation')
  const png = oriented.pngBase64()
  if (!png) return pendingOf(face, 'unsupported', 'encode')
  return {
    key: face.key,
    moduleId: face.moduleId,
    style: face.style,
    axis: face.axis,
    width: oriented.width,
    height: oriented.height,
    locale,
    resolution,
    pngBase64: png,
  }
}

/* ------------------------------------------------------------- readiness */

/**
 * The default face probe: `document.fonts.check` for each named family, plus an
 * advance measurement that is the only honest test for a **system** face.
 *
 * `check()` reports `true` for a family the machine does not have (it only tracks
 * web fonts, and this app bundles none), so it cannot answer "is KaiTi installed?".
 * Measuring `Wg中文` in `"family", <generic>` against `<generic>` can: a substituted
 * face has the generic's advance exactly, an installed one almost never does. Both
 * verdicts are reported; `resolveCalligraphyFace` treats the measurement as the
 * deciding evidence and falls back to `check` only when there is no canvas.
 *
 * The probe returns `null` outside a browser, so a headless caller reports
 * `detectable: false` instead of inventing a missing face.
 */
export function createDomCalligraphyFaceProbe(): CalligraphyFaceProbe {
  const documentRef = (globalThis as { document?: Document }).document
  const fonts = documentRef?.fonts
  if (!fonts || typeof fonts.check !== 'function') return () => null
  let measureContext: CanvasRenderingContext2D | null | undefined
  const context = (): CanvasRenderingContext2D | null => {
    if (measureContext !== undefined) return measureContext
    measureContext = null
    if (documentRef && typeof documentRef.createElement === 'function') {
      const canvas = documentRef.createElement('canvas')
      if (canvas && typeof canvas.getContext === 'function') measureContext = canvas.getContext('2d')
    }
    return measureContext
  }
  const measurements = new Map<string, CalligraphyFaceProbeResult>()
  return (family, weight, italic, fallback) => {
    let checked = false
    try { checked = fonts.check(`${italic ? 'italic ' : ''}${weight} 64px "${family}"`) } catch { checked = false }
    const canvas = context()
    if (!canvas) return { checked, measured: null }
    const cacheKey = `${weight}|${italic ? 1 : 0}|${family}|${fallback}`
    const cached = measurements.get(cacheKey)
    if (cached) return { checked, measured: cached.measured }
    let measured: boolean | null = null
    try {
      const style = `${italic ? 'italic ' : ''}${weight} 64px `
      canvas.font = `${style}"${family}", ${fallback}`
      const withFace = canvas.measureText('Wg中文').width
      canvas.font = `${style}${fallback}`
      const generic = canvas.measureText('Wg中文').width
      measured = Math.abs(withFace - generic) > 0.01
    } catch {
      measured = null
    }
    measurements.set(cacheKey, { checked, measured })
    return { checked, measured }
  }
}

/* ------------------------------------------------------------------- port */

function pendingOf(face: CalligraphyFaceFacts, reason: PendingCalligraphyFace['reason'], detail?: string): PendingCalligraphyFace {
  return { key: face.key, moduleId: face.moduleId, style: face.style, axis: face.axis, reason, ...(detail ? { detail } : {}) }
}

function isPainted(value: PaintedCalligraphyFace | PendingCalligraphyFace): value is PaintedCalligraphyFace {
  return !('reason' in value)
}

/**
 * One face as the painter needs it, or null when the record names no content or no
 * panel. A style/axis the game no longer knows falls back exactly as
 * `calligraphyStyle` / `isCalligraphyAxis` do, so a legacy save keeps printing.
 */
export function calligraphyFaceFactsOf(value: unknown): CalligraphyFaceFacts | null {
  if (!value || typeof value !== 'object') return null
  const face = value as Partial<CalligraphyFaceFacts> & { id?: unknown }
  const key = typeof face.key === 'string' && face.key.length > 0
    ? face.key
    : typeof face.id === 'string' && face.id.length > 0 ? face.id : ''
  if (key.length === 0) return null
  const w = Number(face.w)
  const h = Number(face.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return {
    key,
    moduleId: typeof face.moduleId === 'string' ? face.moduleId : '',
    text: typeof face.text === 'string' ? face.text : '',
    english: typeof face.english === 'string' ? face.english : '',
    style: isCalligraphyStyle(face.style) ? face.style : 'kai',
    axis: isCalligraphyAxis(face.axis) ? face.axis : 'h',
    w,
    h,
    showEnglish: face.showEnglish === true,
    mirrorU: face.mirrorU === true,
    flipV: face.flipV === true,
    locale: typeof face.locale === 'string' ? face.locale : undefined,
  }
}

/**
 * Build the port the Unity shell registers next to `createSignFacePort`,
 * `createPsdHeaderPort` and `createExitFacePort`.
 *
 * `receive` answers only `calligraphyRequest` messages (true for those, false
 * otherwise), so the shell can offer every C# message to it before
 * `stationBridge.receive` and PNG bytes never enter the document reducer.
 *
 * Painting is deduplicated **by content key across requests**: a staged candidate
 * world and the outgoing world can ask for the same inscription, and the second ask
 * awaits the first paint instead of rasterising the same characters twice. Replies
 * are still per request (each `requestId` gets its own chunks and completion), so C#
 * can fence and assemble them independently.
 */
export function createCalligraphyFacePort(options: CalligraphyFacePortOptions = {}): CalligraphyFacePort {
  const send = options.send ?? ((type: string, payload: unknown) => { stationBridge.send(type, payload); return '' })
  const chunkSize = Math.max(1024, Math.floor(options.chunkSize ?? CALLIGRAPHY_FACE_CHUNK_CHARS))
  const createSurface = options.createSurface ?? domCalligraphyFaceSurface
  const ensureFonts = options.ensureFonts ?? (() => defaultEnsureFonts(options.fontReadyTimeoutMs))
  const probe = options.probeFonts ?? createDomCalligraphyFaceProbe()
  const shellLocale = options.locale ?? getLanguage
  let disposed = false
  /** Every answer still running; `whenIdle` waits for these and any started meanwhile. */
  const answers = new Set<Promise<void>>()
  const inflight = new Map<string, Promise<PaintedCalligraphyFace | PendingCalligraphyFace>>()

  const paintFace = (face: CalligraphyFaceFacts, locale: Language): PaintedCalligraphyFace | PendingCalligraphyFace => {
    try {
      return paintCalligraphyFace(face, { createSurface, locale, probe })
    } catch (error) {
      return pendingOf(face, 'unsupported', error instanceof Error ? error.message : 'paint')
    }
  }

  /** Paint one key once; a second request for it while it is running awaits the first. */
  const paintOnce = (face: CalligraphyFaceFacts, locale: Language): Promise<PaintedCalligraphyFace | PendingCalligraphyFace> => {
    const running = inflight.get(face.key)
    if (running) return running
    const started = (async () => {
      // A plate minted before the browser's font set settles keeps a fallback glyph
      // for the session, so readiness is waited for once per in-flight face and a
      // miss is reported pending instead of painted.
      const fonts = await ensureFonts()
      if (!fonts) return pendingOf(face, 'font')
      return paintFace(face, locale)
    })()
    inflight.set(face.key, started)
    const settle = (): void => { if (inflight.get(face.key) === started) inflight.delete(face.key) }
    started.then(settle, settle)
    return started
  }

  /** One chunked reply per painted face. */
  const sendFaces = (request: CalligraphyFaceRequestFacts, painted: PaintedCalligraphyFace[]): void => {
    for (const face of painted) {
      const count = Math.max(1, Math.ceil(face.pngBase64.length / chunkSize))
      for (let index = 0; index < count; index++) {
        const data = face.pngBase64.slice(index * chunkSize, (index + 1) * chunkSize)
        send('calligraphy.faceChunk', {
          requestId: request.requestId,
          revision: request.revision,
          sessionId: request.sessionId,
          key: face.key,
          moduleId: face.moduleId,
          style: face.style,
          axis: face.axis,
          width: face.width,
          height: face.height,
          index,
          count,
          data,
        })
      }
    }
  }

  const readyPayload = (
    request: CalligraphyFaceRequestFacts,
    painted: PaintedCalligraphyFace[],
    pending: PendingCalligraphyFace[],
    artReady: boolean,
  ): Record<string, unknown> => ({
    requestId: request.requestId,
    revision: request.revision,
    sessionId: request.sessionId,
    manifestVersion: CALLIGRAPHY_FONT_VERSION,
    artReady,
    painted: painted.map(face => {
      const resolution = face.resolution
      return {
        key: face.key,
        moduleId: face.moduleId,
        style: face.style,
        axis: face.axis,
        width: face.width,
        height: face.height,
        locale: face.locale,
        // The face actually resolved, and the deliberate fallback when none was.
        family: resolution.family,
        weight: resolution.weight,
        italic: resolution.italic,
        resolvedFamily: resolution.resolved,
        missingFace: resolution.missing,
        detectable: resolution.detectable,
        // One verifier line: `style=kai face=KaiTi missing=0 detected=1 (…)`.
        resolution: describeCalligraphyResolution(resolution),
        bytes: Math.floor(face.pngBase64.length * 3 / 4) - (face.pngBase64.endsWith('==') ? 2 : face.pngBase64.endsWith('=') ? 1 : 0),
        chunks: Math.max(1, Math.ceil(face.pngBase64.length / chunkSize)),
      }
    }),
    pending: pending.map(face => ({
      key: face.key,
      moduleId: face.moduleId,
      style: face.style,
      axis: face.axis,
      reason: face.reason,
      ...(face.detail ? { detail: face.detail } : {}),
    })),
  })

  const answer = async (request: CalligraphyFaceRequestFacts): Promise<void> => {
    const locale = calligraphyFaceLocale(request.locale ?? request.faces[0]?.locale, shellLocale())
    const results = await Promise.all(request.faces.map(face => paintOnce(face, locale)))
    const painted = results.filter(isPainted)
    const pending = results.filter((face): face is PendingCalligraphyFace => !isPainted(face))
    // `artReady` is "this paint can be trusted as final": a font that has not landed
    // is retried, so the request is not ready even though it was answered.
    const artReady = pending.every(face => face.reason !== 'font')
    sendFaces(request, painted)
    send('calligraphy.faceReady', readyPayload(request, painted, pending, artReady))
  }

  const handle = (message: unknown): boolean => {
    if (!isCalligraphyRequest(message)) return false
    const envelope = parseMessage(message) as CalligraphyRequestEnvelope
    const payload = envelope.payload ?? {}
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : (envelope.id ?? '')
    // One paint per key: a name and hand repeated across several plates is one plate.
    const unique = new Map<string, CalligraphyFaceFacts>()
    const rawFaces = Array.isArray(payload.faces) ? payload.faces : []
    for (const raw of rawFaces.slice(0, CALLIGRAPHY_FACE_REQUEST_MAX * 4)) {
      const face = calligraphyFaceFactsOf(raw)
      if (face && !unique.has(face.key)) unique.set(face.key, face)
    }
    const faces = [...unique.values()].slice(0, CALLIGRAPHY_FACE_REQUEST_MAX)
    if (requestId.length === 0 || faces.length === 0) return true
    const request: CalligraphyFaceRequestFacts = {
      requestId,
      revision: typeof envelope.revision === 'number' ? envelope.revision : (typeof payload.revision === 'number' ? payload.revision : -1),
      sessionId: typeof envelope.sessionId === 'string' ? envelope.sessionId : (typeof payload.sessionId === 'string' ? payload.sessionId : ''),
      locale: typeof payload.locale === 'string' ? payload.locale : undefined,
      faces,
    }
    if (disposed) return true
    // Requests are answered concurrently, not queued behind each other: two worlds
    // (a staged candidate and the outgoing station) can ask for the same inscription,
    // and `inflight` makes the second ask share the first paint. Each request still
    // gets its own completion, so C# can assemble and fence them independently.
    const started: Promise<void> = answer(request).catch(() => {
      // A painter failure must still release the request, or C# would wait forever.
      send('calligraphy.faceReady',
        readyPayload(request, [], faces.map(face => pendingOf(face, 'unsupported', 'exception')), false))
    })
    answers.add(started)
    const settle = (): void => { answers.delete(started) }
    started.then(settle, settle)
    return true
  }

  return {
    receive: handle,
    paint(face: CalligraphyFaceFacts, locale?: Language) {
      return paintOnce(face, calligraphyFaceLocale(locale, shellLocale()))
    },
    async whenIdle() {
      // An answer may start while an earlier one is still running (a second request
      // arriving), so drain until the set is empty.
      while (answers.size > 0) await Promise.all([...answers])
      await Promise.all([...inflight.values()])
    },
    chunkSize,
    fontVersion: CALLIGRAPHY_FONT_VERSION,
    dispose() {
      disposed = true
      inflight.clear()
    },
  }
}

/** The approved face of one hand, so a fixture records the same stack a paint uses. */
export function calligraphyFaceStack(style: CalligraphyStyle): string {
  return calligraphyFontFace(style).family
}
