// PSD platform-screen headers across the plan-11 bridge (RCA 15 §5 sub-item 2).
//
// The source draws the printed band over every platform screen (`PsdModel.buildPsd`):
// a **station** panel over each doorway, **route** panels over the fixed spans between
// them, and one paired route+station **sticker** on every half-height fixed pane. The
// panel facts are resolved by C# from the committed document (`psdHeaderInfo`: line
// ink, direction, terminus, next station, the station's own name); the pixels stay
// here, where `render/models/pieces/PsdHeader.ts` is the only painter. This module is
// the Unity reach for it: it paints each panel on a canvas the source's own size
// (`1024` — or `2048` for the paired sticker — by `PSD_HEADER_PIXELS`) and returns the
// PNG in bounded chunks for Unity to upload onto the quad the geometry half posed.
//
// The contract is deliberately a **distinct** request kind, not a discriminant on the
// sign face request: `signFaceProvider` owns sign-board readiness (components,
// pictograms, per-face plates) and its path is verified end to end. A PSD header has
// none of that; it prints one flat panel from resolved text. Sharing the v2 envelope,
// the chunked base64 transport and the 48 KiB slice keeps the transport identical.
//
//   C# → TS  `{ schemaVersion: 2, kind: 'psdHeaderRequest', id, sessionId, revision,
//               payload: { requestId, revision, sessionId, panels: PsdHeaderPanelFacts[] } }`
//   TS → C#  `psd.headerChunk` (bounded `data` base64 slices, one key) and
//            `psd.headerReady` (painted metadata + ink, and any panel still pending)

import { PSD_HEADER_PIXELS, drawPsdHeader } from '../render/models/pieces/PsdHeader.ts'
import type { PsdHeaderInfo } from '../render/models/pieces/PsdHeader.ts'
import { drawPsdArrow, drawPsdBand, drawPsdDoorBand, drawPsdWarning } from '../render/models/pieces/PsdDecals.ts'
import { defaultEnsureFonts, SIGN_FACE_CHUNK_CHARS } from './signFaceProvider.ts'
import { stationBridge } from './stationBridge.ts'

/* ------------------------------------------------------------------ shapes */

export type PsdHeaderPanelKind =
  | 'route'
  | 'station'
  | 'sticker'
  | 'fixed-band'
  | 'door-band'
  | 'door-warning'
  | 'door-arrow-left'
  | 'door-arrow-right'

/** One printed panel C# asks for. Everything here is painted data or the quad's size. */
export interface PsdHeaderPanelFacts {
  /** Opaque content key minted by C#; echoed in the reply so the cache can match it. */
  key: string
  /** The PSD run that minted the panel, for diagnostics. */
  moduleId: string
  /** Every run whose slots print this key. */
  moduleIds?: string[]
  kind: PsdHeaderPanelKind
  /** Canvas width: 1024 for route/station/fixed-band, 2048 for sticker, 640 for door band/warning, 256 for arrow. */
  pixels: number
  /** Canvas height in pixels (256 headers/arrows, 128 bands, 480 warning). */
  pixelHeight?: number
  /** The printed plane in source metres (the quad's size, not the picture). */
  width: number
  height: number
  /** Slots sharing this panel's pixels. */
  slots?: number
  /** `psdHeaderInfo`'s resolved fields. */
  lineId?: string
  colour?: string
  direction?: 'up' | 'down'
  stationName?: string
  stationNameEn?: string
  destination?: string
  destinationEn?: string
  adjacent?: string
  adjacentEn?: string
  terminal?: boolean
  arrow?: number
  directionFallback?: boolean
}

export interface PaintedPsdHeader {
  key: string
  moduleId: string
  kind: PsdHeaderPanelKind
  /** Pixels, e.g. 1024 × 256. */
  width: number
  height: number
  /** Fraction of non-paper pixels; a blank panel can never be mistaken for artwork. */
  ink: number
  /** PNG bytes, base64; sent in `psd.headerChunk` slices, never whole. */
  pngBase64: string
}

export interface PendingPsdHeader {
  key: string
  moduleId: string
  kind: PsdHeaderPanelKind
  /** Why no pixels yet. `empty`/`unsupported` are final; `font` is retried. */
  reason: 'font' | 'unsupported' | 'empty'
  detail?: string
}

/** A canvas the painter can draw into. Injectable so a fixture can paint the same panel. */
export interface PsdHeaderSurface {
  readonly width: number
  readonly height: number
  readonly context: CanvasRenderingContext2D
  pngBase64(): string | null
}

export type PsdHeaderSurfaceFactory = (width: number, height: number) => PsdHeaderSurface | null

export interface PsdHeaderPort {
  /** Paint the panels in one `psdHeaderRequest`. Returns false for any other message. */
  receive(message: unknown): boolean
  /** Paint one panel now; exposed for fixtures and for the shell's own previews. */
  paint(panel: PsdHeaderPanelFacts): PaintedPsdHeader | PendingPsdHeader
  /** Resolves when every request received so far has been answered. */
  whenIdle(): Promise<void>
  /** Bytes per `psd.headerChunk` slice (base64 characters). */
  readonly chunkSize: number
  dispose(): void
}

export interface PsdHeaderPortOptions {
  /** Transport for `psd.headerChunk` / `psd.headerReady`. Defaults to `stationBridge.send`. */
  send?: (type: string, payload: unknown) => string | void
  /** Where the painter draws. Defaults to a DOM canvas. */
  createSurface?: PsdHeaderSurfaceFactory
  /** Font readiness; resolves false when the browser cannot offer the CJK face yet. */
  ensureFonts?: () => Promise<boolean>
  chunkSize?: number
  /** How long a font wait may take before the panel is reported pending. */
  fontReadyTimeoutMs?: number
}

/* --------------------------------------------------------------- messaging */

/** How many panels one C# request may carry, so one message stays small. */
export const PSD_HEADER_REQUEST_MAX = 32

/** The header canvas is the source's own height on every panel kind. */
export const PSD_HEADER_PANEL_HEIGHT = PSD_HEADER_PIXELS

/** The source's line-ink fallback (`buildPsd`'s `line?.colour ?? '#1b6fd6'`). */
export const PSD_HEADER_DEFAULT_COLOUR = '#1b6fd6'

interface PsdHeaderRequestEnvelope {
  schemaVersion?: number
  kind?: string
  type?: string
  id?: string
  sessionId?: string
  revision?: number
  payload?: { requestId?: unknown; revision?: unknown; sessionId?: unknown; panels?: unknown }
}

function parseMessage(message: unknown): PsdHeaderRequestEnvelope | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown
      return parsed && typeof parsed === 'object' ? parsed as PsdHeaderRequestEnvelope : null
    } catch {
      return null
    }
  }
  if (message && typeof message === 'object') return message as PsdHeaderRequestEnvelope
  return null
}

/** True for the one message shape this port answers. */
export function isPsdHeaderRequest(message: unknown): boolean {
  const envelope = parseMessage(message)
  if (!envelope) return false
  return envelope.kind === 'psdHeaderRequest' || envelope.type === 'psd.requestHeader'
}

/* ---------------------------------------------------------------- painting */

/** A canvas surface over the DOM, or null outside a browser. */
export function domPsdHeaderSurface(width: number, height: number): PsdHeaderSurface | null {
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

/** The `#rrggbb`/`#rgb` ink the painter accepts, or the source's default. */
export function psdHeaderColour(value: unknown): string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
    ? value
    : PSD_HEADER_DEFAULT_COLOUR
}

function psdHeaderInfoOf(panel: PsdHeaderPanelFacts): PsdHeaderInfo {
  return {
    destination: typeof panel.destination === 'string' ? panel.destination : '',
    destinationEn: typeof panel.destinationEn === 'string' ? panel.destinationEn : '',
    adjacent: typeof panel.adjacent === 'string' ? panel.adjacent : '',
    adjacentEn: typeof panel.adjacentEn === 'string' ? panel.adjacentEn : '',
    terminal: panel.terminal === true,
    arrow: panel.arrow === -1 ? -1 : 1,
  }
}

function parsePanelKind(value: unknown): PsdHeaderPanelKind {
  switch (value) {
    case 'station':
    case 'sticker':
    case 'fixed-band':
    case 'door-band':
    case 'door-warning':
    case 'door-arrow-left':
    case 'door-arrow-right':
      return value
    default:
      return 'route'
  }
}

function defaultPixelSize(kind: PsdHeaderPanelKind, requestedWidth?: number, requestedHeight?: number): [number, number] {
  switch (kind) {
    case 'sticker': return [2048, PSD_HEADER_PANEL_HEIGHT]
    case 'fixed-band': return [1024, 128]
    case 'door-band': return [640, 128]
    case 'door-warning': return [640, 480]
    case 'door-arrow-left':
    case 'door-arrow-right': return [256, 256]
    default:
      return [requestedWidth === 2048 ? 2048 : 1024, requestedHeight && requestedHeight > 0 ? requestedHeight : PSD_HEADER_PANEL_HEIGHT]
  }
}

function isTransparentDecal(kind: PsdHeaderPanelKind): boolean {
  return kind === 'door-warning' || kind === 'door-arrow-left' || kind === 'door-arrow-right'
}

/** Fraction of pixels that are not the panel's paper colour (or non-transparent for alpha decals); -1 when unmeasurable. */
function inkOf(context: CanvasRenderingContext2D, width: number, height: number, transparent = false): number {
  try {
    if (typeof context.getImageData !== 'function') return -1
    const data = context.getImageData(0, 0, width, height).data
    if (data.length < 4) return 0
    if (transparent) {
      let ink = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++
      return ink / (width * height)
    }
    // `drawPsdHeader` always grounds the panel on this paper (`#f4f6f8`); the bottom-left
    // pixel is the colour bar, so it cannot stand in for the paper.
    const paper = [244, 246, 248]
    let ink = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== paper[0] || data[i + 1] !== paper[1] || data[i + 2] !== paper[2]) ink++
    }
    return ink / (width * height)
  } catch {
    return -1
  }
}

/**
 * Paint one PSD header or safety vinyl decal panel with the shipping engine.
 *
 * A `sticker` is the source's paired print: the route panel's 1024 px on the left and
 * the station panel's on the right of a 2048 px canvas (`PsdModel.buildPsd` translates
 * by 1024 for the second draw). The four safety vinyl kinds call `PsdDecals.ts` directly.
 */
export function paintPsdHeader(
  panel: PsdHeaderPanelFacts,
  options: { createSurface?: PsdHeaderSurfaceFactory } = {},
): PaintedPsdHeader | PendingPsdHeader {
  if (!panel || typeof panel.key !== 'string' || panel.key.length === 0) {
    return { key: panel?.key ?? '', moduleId: panel?.moduleId ?? '', kind: panel?.kind ?? 'route', reason: 'unsupported', detail: 'key' }
  }
  const kind = parsePanelKind(panel.kind)
  const [pixels, pixelHeight] = defaultPixelSize(kind, panel.pixels, panel.pixelHeight)
  const createSurface = options.createSurface ?? domPsdHeaderSurface
  const surface = createSurface(pixels, pixelHeight)
  if (!surface) {
    return { key: panel.key, moduleId: panel.moduleId, kind, reason: 'unsupported', detail: 'canvas' }
  }
  const context = surface.context
  if (kind === 'fixed-band') {
    drawPsdBand(context)
  } else if (kind === 'door-band') {
    drawPsdDoorBand(context)
  } else if (kind === 'door-warning') {
    drawPsdWarning(context)
  } else if (kind === 'door-arrow-left') {
    drawPsdArrow(context, -1)
  } else if (kind === 'door-arrow-right') {
    drawPsdArrow(context, 1)
  } else {
    const colour = psdHeaderColour(panel.colour)
    const info = psdHeaderInfoOf(panel)
    const name = typeof panel.stationName === 'string' ? panel.stationName : ''
    const nameEn = typeof panel.stationNameEn === 'string' ? panel.stationNameEn : ''
    if (kind === 'sticker') {
      drawPsdHeader(context, 'route', colour, info, name, nameEn)
      context.save()
      context.translate(1024, 0)
      drawPsdHeader(context, 'station', colour, info, name, nameEn)
      context.restore()
    } else {
      drawPsdHeader(context, kind, colour, info, name, nameEn)
    }
  }
  const png = surface.pngBase64()
  if (!png) {
    return { key: panel.key, moduleId: panel.moduleId, kind, reason: 'unsupported', detail: 'encode' }
  }
  return {
    key: panel.key,
    moduleId: panel.moduleId,
    kind,
    width: surface.width,
    height: surface.height,
    ink: inkOf(context, surface.width, surface.height, isTransparentDecal(kind)),
    pngBase64: png,
  }
}

/* --------------------------------------------------------------------- port */

function pendingOf(panel: PsdHeaderPanelFacts, reason: PendingPsdHeader['reason'], detail?: string): PendingPsdHeader {
  return { key: panel.key, moduleId: panel.moduleId, kind: panel.kind, reason, ...(detail ? { detail } : {}) }
}

function panelOfFacts(value: unknown): PsdHeaderPanelFacts | null {
  if (!value || typeof value !== 'object') return null
  const panel = value as Partial<PsdHeaderPanelFacts>
  if (typeof panel.key !== 'string' || panel.key.length === 0) return null
  const kind = parsePanelKind(panel.kind)
  const [defaultW, defaultH] = defaultPixelSize(kind, Number(panel.pixels), Number(panel.pixelHeight))
  const width = Number(panel.width)
  const height = Number(panel.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    key: panel.key,
    moduleId: typeof panel.moduleId === 'string' ? panel.moduleId : '',
    moduleIds: Array.isArray(panel.moduleIds) ? panel.moduleIds.filter((id): id is string => typeof id === 'string') : [],
    kind,
    pixels: defaultW,
    pixelHeight: defaultH,
    width,
    height,
    slots: Number.isFinite(Number(panel.slots)) ? Number(panel.slots) : 1,
    lineId: typeof panel.lineId === 'string' ? panel.lineId : '',
    colour: typeof panel.colour === 'string' ? panel.colour : '',
    direction: panel.direction === 'down' ? 'down' : 'up',
    stationName: typeof panel.stationName === 'string' ? panel.stationName : '',
    stationNameEn: typeof panel.stationNameEn === 'string' ? panel.stationNameEn : '',
    destination: typeof panel.destination === 'string' ? panel.destination : '',
    destinationEn: typeof panel.destinationEn === 'string' ? panel.destinationEn : '',
    adjacent: typeof panel.adjacent === 'string' ? panel.adjacent : '',
    adjacentEn: typeof panel.adjacentEn === 'string' ? panel.adjacentEn : '',
    terminal: panel.terminal === true,
    arrow: panel.arrow === -1 ? -1 : 1,
    directionFallback: panel.directionFallback === true,
  }
}

/**
 * Build the port the Unity shell registers next to `createSignFacePort`.
 *
 * `receive` answers only `psdHeaderRequest` messages (true for those, false
 * otherwise), so the shell can offer every C# message to it before the state reducer
 * and a PNG never enters the document reducer.
 */
export function createPsdHeaderPort(options: PsdHeaderPortOptions = {}): PsdHeaderPort {
  const send = options.send ?? ((type: string, payload: unknown) => { stationBridge.send(type, payload); return '' })
  const chunkSize = Math.max(1024, Math.floor(options.chunkSize ?? SIGN_FACE_CHUNK_CHARS))
  const createSurface = options.createSurface ?? domPsdHeaderSurface
  const ensureFonts = options.ensureFonts ?? (() => defaultEnsureFonts(options.fontReadyTimeoutMs))
  let disposed = false
  let work: Promise<void> = Promise.resolve()

  const paintPanel = (panel: PsdHeaderPanelFacts): PaintedPsdHeader | PendingPsdHeader => {
    try {
      return paintPsdHeader(panel, { createSurface })
    } catch (error) {
      return pendingOf(panel, 'unsupported', error instanceof Error ? error.message : 'paint')
    }
  }

  /** One chunked reply per painted panel. */
  const sendPanel = (requestId: string, revision: number, sessionId: string, painted: PaintedPsdHeader[]): void => {
    for (const panel of painted) {
      const count = Math.max(1, Math.ceil(panel.pngBase64.length / chunkSize))
      for (let index = 0; index < count; index++) {
        const data = panel.pngBase64.slice(index * chunkSize, (index + 1) * chunkSize)
        send('psd.headerChunk', {
          requestId,
          revision,
          sessionId,
          key: panel.key,
          moduleId: panel.moduleId,
          kind: panel.kind,
          width: panel.width,
          height: panel.height,
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
    painted: PaintedPsdHeader[],
    pending: PendingPsdHeader[],
    artReady: boolean,
  ): Record<string, unknown> => ({
    requestId,
    revision,
    sessionId,
    artReady,
    painted: painted.map(panel => ({
      key: panel.key,
      moduleId: panel.moduleId,
      kind: panel.kind,
      width: panel.width,
      height: panel.height,
      ink: panel.ink,
      bytes: Math.floor(panel.pngBase64.length * 3 / 4) - (panel.pngBase64.endsWith('==') ? 2 : panel.pngBase64.endsWith('=') ? 1 : 0),
      chunks: Math.max(1, Math.ceil(panel.pngBase64.length / chunkSize)),
    })),
    pending: pending.map(panel => ({
      key: panel.key,
      moduleId: panel.moduleId,
      kind: panel.kind,
      reason: panel.reason,
      ...(panel.detail ? { detail: panel.detail } : {}),
    })),
  })

  const answer = async (requestId: string, revision: number, sessionId: string, panels: PsdHeaderPanelFacts[]): Promise<void> => {
    // Every panel prints type (the station's name is always drawn), so a canvas painted
    // before the CJK face lands would keep a fallback glyph for the session. Report it
    // pending and let C# ask again, exactly as the sign painter does.
    if (panels.length > 0) {
      const fonts = await ensureFonts()
      if (!fonts) {
        const pending = panels.map(panel => pendingOf(panel, 'font'))
        send('psd.headerReady', readyPayload(requestId, revision, sessionId, [], pending, false))
        return
      }
    }
    const painted: PaintedPsdHeader[] = []
    const pending: PendingPsdHeader[] = []
    for (const panel of panels) {
      const result = paintPanel(panel)
      if ('reason' in result) pending.push(result)
      else painted.push(result)
    }
    sendPanel(requestId, revision, sessionId, painted)
    send('psd.headerReady', readyPayload(requestId, revision, sessionId, painted, pending, true))
  }

  const handle = (message: unknown): boolean => {
    if (!isPsdHeaderRequest(message)) return false
    const envelope = parseMessage(message) as PsdHeaderRequestEnvelope
    const payload = envelope.payload ?? {}
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : (envelope.id ?? '')
    // The same key can serve every slot of several runs; paint it once and answer once.
    const unique = new Map<string, PsdHeaderPanelFacts>()
    const rawPanels = Array.isArray(payload.panels) ? payload.panels : []
    for (const raw of rawPanels.slice(0, PSD_HEADER_REQUEST_MAX * 4)) {
      const panel = panelOfFacts(raw)
      if (panel && !unique.has(panel.key)) unique.set(panel.key, panel)
    }
    const panels = [...unique.values()]
    if (requestId.length === 0 || panels.length === 0) return true
    const revision = typeof envelope.revision === 'number' ? envelope.revision : (typeof payload.revision === 'number' ? payload.revision : -1)
    const sessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId : (typeof payload.sessionId === 'string' ? payload.sessionId : '')
    if (disposed) return true
    work = work.then(() => answer(requestId, revision, sessionId, panels)).catch(() => {
      // A painter failure must still release the request, or C# would wait forever.
      send('psd.headerReady', readyPayload(requestId, revision, sessionId, [], panels.map(panel => pendingOf(panel, 'unsupported', 'exception')), false))
    })
    return true
  }

  return {
    receive: handle,
    paint(panel: PsdHeaderPanelFacts) {
      return paintPanel(panel)
    },
    whenIdle: () => work,
    chunkSize,
    dispose() { disposed = true },
  }
}
