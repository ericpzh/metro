// Sign faces across the plan-11 bridge: C# asks, the shipping face engine paints.
//
// Unity is the document and the renderer; the 指示牌's pixels stay in this
// codebase. `render/signFace.ts` is the only drawing code for an overhead sign
// (the model's lit face, the editor's preview and the hover ghost all call
// `drawSignPanel`), so this module is the Unity **reach** for it: it takes a
// normalized board from C#, paints it into a canvas of the plate's own size at
// `PX_PER_METRE`, and returns the PNG in bounded chunks for Unity to upload.
//
// It deliberately owns no geometry, no font table and no layout: the board's
// metres come from `sim/sign.ts` (`signPlate`), the components and line facts
// come from the committed document (C# `StationSignSignage`), and everything
// between them is `drawSignPanel`. A second renderer here would be a second
// engine, and the board Unity showed would no longer be the board the browser
// shows.
//
// Readiness is explicit because a face is a texture minted once: a board painted
// before its pictograms decode would keep the marks off it for the session. A
// request that arrives before the fonts or the pictogram art are in hand is
// answered with a **pending** record (`reason: 'font' | 'pictogram'`) and no
// pixels, and C# asks again — never with a blank plate.
//
// The request/response contract is published in the packet F handoff
// (`unity/plan/11-evidence/F.md`) and is deliberately small:
//
//   C# → TS  `{ schemaVersion: 2, kind: 'signRequest', id, sessionId, revision,
//               payload: { requestId, locale, faces: SignFaceBoardFacts[] } }`
//   TS → C#  `sign.faceChunk` (bounded `data` base64 slices, one key/face) and
//            `sign.faceReady` (per-request completion: painted metadata and the
//            faces still pending).

import { getLanguage, setLanguage, type Language } from '../sim/i18n.ts'
import {
  PX_PER_METRE,
  SIGN_ARROWS,
  SIGN_ICONS,
  isSignIcon,
  signIconIsDrawn,
  signPlate,
} from '../sim/sign.ts'
import type {
  SignArrow,
  SignComponent,
  SignFace as SignFaceGeometry,
  SignIcon,
  SignLayout,
  SignPanelSize,
  SignSide,
} from '../sim/sign.ts'
import type { LineDef } from '../sim/types.ts'
import { drawSignPanel, pictograms, setPictograms } from '../render/signFace.ts'
import { stationBridge } from './stationBridge.ts'

/* ------------------------------------------------------------------ shapes */

/** One line fact a shield prints. Only what `drawSignPanel` reads (`sim/sign.ts`). */
export interface SignFaceLineFacts {
  id: string
  name: string
  colour: string
}

/** One normalized component, exactly the fields `sim/sign.ts` defines. */
export interface SignFaceComponentFacts {
  id: string
  kind: 'arrow' | 'line' | 'text' | 'icon'
  x: number
  y: number
  scale: number
  side?: SignSide
  text?: string
  arrow?: string
  lineId?: string
  english?: boolean
  icon?: string
}

/** One board face C# wants painted: its own content, on the pair's panel. */
export interface SignFaceBoardFacts {
  /** Opaque content key minted by C#; echoed in the reply so the cache can match it. */
  key: string
  moduleId: string
  face: 'front' | 'back'
  /** The **pair's** panel metres (`signBoardsPanel`), which both faces print on. */
  panel: { w: number; h: number }
  components: SignFaceComponentFacts[]
  lines: SignFaceLineFacts[]
  defaultLineId?: string
  /** Requested locale; the shell's own when omitted. */
  locale?: string
}

/** The whole C# request: how many faces one station commit needs. */
export interface SignFaceRequestFacts {
  requestId: string
  revision: number
  sessionId: string
  locale?: string
  faces: SignFaceBoardFacts[]
}

export interface PaintedSignFace {
  key: string
  moduleId: string
  face: 'front' | 'back'
  width: number
  height: number
  /** PNG bytes, base64. Sent in `sign.faceChunk` slices, never whole. */
  pngBase64: string
  /** Component ids the painter refused; the face still painted everything else. */
  rejected?: string[]
}

export interface PendingSignFace {
  key: string
  moduleId: string
  face: 'front' | 'back'
  /** Why no pixels yet. `empty` is final; `font`/`pictogram` are retried. */
  reason: 'font' | 'pictogram' | 'unsupported' | 'empty'
  detail?: string
}

/** A canvas the painter can draw into. Injectable so Node can paint the same board. */
export interface SignFaceSurface {
  readonly width: number
  readonly height: number
  readonly context: CanvasRenderingContext2D
  /** The encoded PNG as base64, or null when this surface cannot encode. */
  pngBase64(): string | null
}

export type SignFaceSurfaceFactory = (width: number, height: number) => SignFaceSurface | null

/** The port the Unity shell holds. `receive` is called for every C# → TS message. */
export interface SignFacePort {
  /** Paint the boards in one `signRequest`. Returns false for any other message. */
  receive(message: unknown): boolean
  /** Paint one board now; exposed for fixtures and for the shell's own previews. */
  paint(board: SignFaceBoardFacts, locale?: string): PaintedSignFace | PendingSignFace
  /** Resolves when every request received so far has been answered. */
  whenIdle(): Promise<void>
  /** Bytes per `sign.faceChunk` slice (base64 characters). */
  readonly chunkSize: number
  dispose(): void
}

export interface SignFacePortOptions {
  /** Transport for `sign.faceChunk` / `sign.faceReady`. Defaults to `stationBridge.send`. */
  send?: (type: string, payload: unknown) => string | void
  /** Where the painter draws. Defaults to a DOM canvas. */
  createSurface?: SignFaceSurfaceFactory
  /** Decode the pictogram art; resolves whether the art is now in the registry. */
  ensurePictograms?: () => Promise<boolean>
  /** Font readiness; resolves false when the browser cannot offer the CJK face yet. */
  ensureFonts?: () => Promise<boolean>
  /** The locale the shell is showing, used when a board names none. */
  locale?: () => Language
  chunkSize?: number
  /** How long a font wait may take before the face is reported pending. */
  fontReadyTimeoutMs?: number
}

/* ------------------------------------------------------------- messaging */

/**
 * How much base64 one `sign.faceChunk` carries. 48 KiB is a string every
 * WebGL `SendMessage` call handles comfortably, and a 3.5 m board's PNG comes in
 * two or three slices.
 */
export const SIGN_FACE_CHUNK_CHARS = 48 * 1024

/** How many boards one C# request may carry, so one message stays small. */
export const SIGN_FACE_REQUEST_MAX = 32

/** A C# → TS message is a v2 reply-shaped envelope with `kind: 'signRequest'`. */
interface SignRequestEnvelope {
  schemaVersion?: number
  kind?: string
  type?: string
  id?: string
  sessionId?: string
  revision?: number
  payload?: Partial<SignFaceRequestFacts> & { faces?: unknown }
}

function parseMessage(message: unknown): SignRequestEnvelope | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown
      return parsed && typeof parsed === 'object' ? parsed as SignRequestEnvelope : null
    } catch {
      return null
    }
  }
  if (message && typeof message === 'object') return message as SignRequestEnvelope
  return null
}

/** True for the one message shape this port answers. */
export function isSignRequest(message: unknown): boolean {
  const envelope = parseMessage(message)
  if (!envelope) return false
  if (envelope.kind === 'signRequest' || envelope.type === 'sign.requestFace') return true
  return false
}

/* -------------------------------------------------------------- painting */

const CJK_FONT_FAMILY = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'

/** Normalize the locale a board asks for into the sim's own type. */
export function signFaceLocale(value: unknown, fallback: Language = 'zh-CN'): Language {
  if (value === 'en') return 'en'
  if (value === 'zh-CN' || value === 'zh' || value === 'zh_CN') return 'zh-CN'
  return fallback
}

/** One component as `sim/sign.ts` would hold it, or null when the record is unusable. */
function componentOf(facts: SignFaceComponentFacts): SignComponent | null {
  const x = Number(facts.x)
  const y = Number(facts.y)
  const scale = Number(facts.scale)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null
  const side: SignSide = facts.side === 'left' || facts.side === 'right' ? facts.side : 'both'
  const id = typeof facts.id === 'string' && facts.id.length > 0 ? facts.id : 'c'
  switch (facts.kind) {
    case 'arrow': {
      const arrow = (SIGN_ARROWS as readonly string[]).includes(facts.arrow ?? '')
        ? facts.arrow as SignArrow
        : 'right'
      return { id, kind: 'arrow', arrow, x, y, scale, side }
    }
    case 'line':
      return {
        id, kind: 'line', x, y, scale, side,
        lineId: typeof facts.lineId === 'string' ? facts.lineId : '',
        english: facts.english === true,
      }
    case 'text': {
      if (typeof facts.text !== 'string' || facts.text.length === 0) return null
      return { id, kind: 'text', text: facts.text, x, y, scale, side }
    }
    case 'icon': {
      const icon = (SIGN_ICONS as readonly string[]).includes(facts.icon ?? '')
        ? facts.icon as SignIcon
        : null
      if (icon === null) return null
      return { id, kind: 'icon', icon, x, y, scale, side }
    }
    default:
      return null
  }
}

/** The layout the painter draws, and whether every requested record survived. */
export function signFaceLayout(facts: SignFaceBoardFacts): { layout: SignLayout; rejected: string[] } {
  const layout: SignLayout = []
  const rejected: string[] = []
  for (const component of Array.isArray(facts.components) ? facts.components : []) {
    const parsed = componentOf(component)
    if (parsed) layout.push(parsed)
    else rejected.push(component && typeof component.id === 'string' ? component.id : '?')
  }
  return { layout, rejected }
}

/** The geometry face a logical face prints on (`SIGN_FACE_OF`). */
export function signFaceGeometry(face: 'front' | 'back'): SignFaceGeometry {
  return face === 'front' ? 'left' : 'right'
}

/** A canvas surface over the DOM, or null outside a browser. */
export function domSignFaceSurface(width: number, height: number): SignFaceSurface | null {
  const documentRef = (globalThis as { document?: Document }).document
  if (!documentRef || typeof documentRef.createElement !== 'function') return null
  const canvas = documentRef.createElement('canvas')
  if (!canvas || typeof canvas.getContext !== 'function') return null
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  // `drawSignPanel` rounds the frame and the shield corners; a browser without the
  // path API would throw mid-face and lose the plate. Give it the one shape it asks for.
  const rounded = context as unknown as {
    roundRect?: (x: number, y: number, w: number, h: number, r: number | number[]) => void
  }
  if (typeof rounded.roundRect !== 'function') {
    rounded.roundRect = function roundRectFallback(x, y, w, h, r) {
      const radius = Math.max(0, Math.min(Array.isArray(r) ? r[0] ?? 0 : r, Math.abs(w) / 2, Math.abs(h) / 2))
      context.moveTo(x + radius, y)
      context.lineTo(x + w - radius, y)
      context.quadraticCurveTo(x + w, y, x + w, y + radius)
      context.lineTo(x + w, y + h - radius)
      context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
      context.lineTo(x + radius, y + h)
      context.quadraticCurveTo(x, y + h, x, y + h - radius)
      context.lineTo(x, y + radius)
      context.quadraticCurveTo(x, y, x + radius, y)
      context.closePath()
    }
  }
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

/**
 * Paint one board face with the shipping engine.
 *
 * The panel is the **pair's** (`signBoardsPanel`): both faces are plates on one
 * piece of steel, so a short back prints on the same width as a long front and
 * `drawSignPanel` centres its own ink in that panel. The plate's pixels are
 * `signPlate(panel)` — 512 px/m, the model's own texture size — so the pixels
 * Unity uploads are the model's pixels, not a preview's.
 */
export function paintSignFace(
  board: SignFaceBoardFacts,
  options: { createSurface?: SignFaceSurfaceFactory; locale?: Language } = {},
): PaintedSignFace | PendingSignFace {
  const panel = board.panel
  if (!panel || !Number.isFinite(panel.w) || !Number.isFinite(panel.h) || panel.w <= 0 || panel.h <= 0) {
    return { key: board.key, moduleId: board.moduleId, face: board.face, reason: 'unsupported', detail: 'panel' }
  }
  const size: SignPanelSize = { w: panel.w, h: panel.h }
  const plate = signPlate(size)
  const createSurface = options.createSurface ?? domSignFaceSurface
  const surface = createSurface(plate.width, plate.height)
  if (!surface) {
    return { key: board.key, moduleId: board.moduleId, face: board.face, reason: 'unsupported', detail: 'canvas' }
  }
  const { layout, rejected } = signFaceLayout(board)
  if (layout.length === 0 && rejected.length === 0) {
    return { key: board.key, moduleId: board.moduleId, face: board.face, reason: 'empty' }
  }
  const locale = signFaceLocale(board.locale, options.locale ?? getLanguage())
  const previous = getLanguage()
  const switched = locale !== previous
  if (switched) setLanguage(locale)
  try {
    drawSignPanel(
      surface.context,
      layout,
      {
        lines: (Array.isArray(board.lines) ? board.lines : []) as unknown as readonly LineDef[],
        defaultLineId: board.defaultLineId,
        panel: size,
        ppm: PX_PER_METRE,
      },
      signFaceGeometry(board.face),
    )
  } finally {
    if (switched) setLanguage(previous)
  }
  const png = surface.pngBase64()
  if (!png) {
    return { key: board.key, moduleId: board.moduleId, face: board.face, reason: 'unsupported', detail: 'encode' }
  }
  const painted: PaintedSignFace = {
    key: board.key,
    moduleId: board.moduleId,
    face: board.face,
    width: plate.width,
    height: plate.height,
    pngBase64: png,
  }
  if (rejected.length > 0) painted.rejected = rejected
  return painted
}

/* -------------------------------------------------------------- readiness */

interface FontFaceSetLike {
  readonly status: string
  ready: Promise<unknown>
}

function fontsOf(): FontFaceSetLike | null {
  const documentRef = (globalThis as { document?: { fonts?: FontFaceSetLike } }).document
  return documentRef?.fonts ?? null
}

/** True once the browser says it has no pending font work; false when that never came. */
export async function defaultEnsureFonts(timeoutMs = 4000): Promise<boolean> {
  const fonts = fontsOf()
  if (!fonts) return true
  if (fonts.status === 'loaded') return true
  await Promise.race([
    fonts.ready.catch(() => null),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ])
  return fonts.status === 'loaded'
}

/**
 * The pictogram art, decoded once per page.
 *
 * `render/pictograms.ts` is the browser half (Vite glob + image decode), so it is
 * imported lazily: a headless caller that injects its own art never evaluates it,
 * and a browser that has not loaded the art yet reports the face pending instead
 * of printing a board with its marks missing.
 */
export async function defaultEnsurePictograms(): Promise<boolean> {
  try {
    const module = await import('../render/pictograms.ts')
    const art = await module.loadPictograms()
    return art.size > 0
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------- port */

function pendingOf(board: SignFaceBoardFacts, reason: PendingSignFace['reason'], detail?: string): PendingSignFace {
  return { key: board.key, moduleId: board.moduleId, face: board.face, reason, ...(detail ? { detail } : {}) }
}

function faceOfFacts(value: unknown): SignFaceBoardFacts | null {
  if (!value || typeof value !== 'object') return null
  const board = value as Partial<SignFaceBoardFacts>
  if (typeof board.key !== 'string' || board.key.length === 0) return null
  if (board.face !== 'front' && board.face !== 'back') return null
  const panel = board.panel as { w?: unknown; h?: unknown } | undefined
  const w = Number(panel?.w)
  const h = Number(panel?.h)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  return {
    key: board.key,
    moduleId: typeof board.moduleId === 'string' ? board.moduleId : '',
    face: board.face,
    panel: { w, h },
    components: Array.isArray(board.components) ? board.components as SignFaceComponentFacts[] : [],
    lines: Array.isArray(board.lines) ? board.lines as SignFaceLineFacts[] : [],
    defaultLineId: typeof board.defaultLineId === 'string' ? board.defaultLineId : undefined,
    locale: typeof board.locale === 'string' ? board.locale : undefined,
  }
}

/**
 * Build the port the Unity shell registers.
 *
 * `receive` answers only `signRequest` messages (it returns true for those and
 * false otherwise), so the shell can offer every C# message to it first and fall
 * through to `stationBridge.receive` for acks, commits and state — the transport
 * reducer never sees a sign request.
 */
export function createSignFacePort(options: SignFacePortOptions = {}): SignFacePort {
  const send = options.send ?? ((type: string, payload: unknown) => { stationBridge.send(type, payload); return '' })
  const chunkSize = Math.max(1024, Math.floor(options.chunkSize ?? SIGN_FACE_CHUNK_CHARS))
  const createSurface = options.createSurface ?? domSignFaceSurface
  const ensurePictograms = options.ensurePictograms ?? defaultEnsurePictograms
  const ensureFonts = options.ensureFonts ?? (() => defaultEnsureFonts(options.fontReadyTimeoutMs))
  const shellLocale = options.locale ?? getLanguage
  let disposed = false
  let work: Promise<void> = Promise.resolve()

  const paintBoard = (board: SignFaceBoardFacts, locale: Language): PaintedSignFace | PendingSignFace => {
    try {
      return paintSignFace(board, { createSurface, locale })
    } catch (error) {
      return pendingOf(board, 'unsupported', error instanceof Error ? error.message : 'paint')
    }
  }

  /** One chunked reply per painted face. */
  const sendFace = (request: SignFaceRequestFacts, painted: PaintedSignFace[]): void => {
    for (const face of painted) {
      const count = Math.max(1, Math.ceil(face.pngBase64.length / chunkSize))
      for (let index = 0; index < count; index++) {
        const data = face.pngBase64.slice(index * chunkSize, (index + 1) * chunkSize)
        send('sign.faceChunk', {
          requestId: request.requestId,
          revision: request.revision,
          sessionId: request.sessionId,
          key: face.key,
          moduleId: face.moduleId,
          face: face.face,
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
    request: SignFaceRequestFacts,
    painted: PaintedSignFace[],
    pending: PendingSignFace[],
    artReady: boolean,
  ): Record<string, unknown> => ({
    requestId: request.requestId,
    revision: request.revision,
    sessionId: request.sessionId,
    artReady,
    painted: painted.map(face => ({
      key: face.key,
      moduleId: face.moduleId,
      face: face.face,
      width: face.width,
      height: face.height,
      bytes: Math.floor(face.pngBase64.length * 3 / 4) - (face.pngBase64.endsWith('==') ? 2 : face.pngBase64.endsWith('=') ? 1 : 0),
      chunks: Math.max(1, Math.ceil(face.pngBase64.length / chunkSize)),
    })),
    pending: pending.map(face => ({ key: face.key, moduleId: face.moduleId, face: face.face, reason: face.reason, ...(face.detail ? { detail: face.detail } : {}) })),
  })

  /** The bitmap pictograms these boards actually print (the drawn marks need no art). */
  const bitmapIcons = (boards: SignFaceBoardFacts[]): SignIcon[] => {
    const wanted = new Set<SignIcon>()
    for (const board of boards) {
      for (const component of board.components) {
        if (component.kind !== 'icon') continue
        const icon = component.icon
        if (typeof icon !== 'string' || !isSignIcon(icon) || signIconIsDrawn(icon)) continue
        wanted.add(icon)
      }
    }
    return [...wanted]
  }

  const answer = async (request: SignFaceRequestFacts, boards: SignFaceBoardFacts[]): Promise<void> => {
    const locale = signFaceLocale(request.locale ?? boards[0]?.locale, shellLocale())
    const painted: PaintedSignFace[] = []
    const pending: PendingSignFace[] = []
    // A face printed before its type is in hand keeps the fallback glyph for the
    // session, and a face printed before its pictograms decode keeps the marks off
    // it. Wait for exactly the resources these boards name, then report what is
    // still missing instead of minting a wrong plate.
    const needsType = boards.some(board => board.components.some(component => component.kind === 'text' || component.kind === 'line'))
    if (needsType) {
      const fonts = await ensureFonts()
      if (!fonts) {
        for (const board of boards) pending.push(pendingOf(board, 'font'))
        send('sign.faceReady', readyPayload(request, [], pending, false))
        return
      }
    }
    const icons = bitmapIcons(boards)
    const missing = icons.filter(icon => !pictograms().has(icon))
    if (missing.length > 0) {
      const art = await ensurePictograms()
      const absent = icons.filter(icon => !pictograms().has(icon))
      if (!art && absent.length > 0) {
        for (const board of boards) pending.push(pendingOf(board, 'pictogram', absent.join(',')))
        send('sign.faceReady', readyPayload(request, [], pending, false))
        return
      }
    }
    for (const board of boards) {
      if (board.components.length === 0) {
        pending.push(pendingOf(board, 'empty'))
        continue
      }
      const result = paintBoard(board, signFaceLocale(board.locale, locale))
      if ('reason' in result) pending.push(result)
      else painted.push(result)
    }
    sendFace(request, painted)
    send('sign.faceReady', readyPayload(request, painted, pending, true))
  }

  const handle = (message: unknown): boolean => {
    if (!isSignRequest(message)) return false
    const envelope = parseMessage(message) as SignRequestEnvelope
    const payload = envelope.payload ?? {}
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : (envelope.id ?? '')
    const rawFaces = Array.isArray(payload.faces) ? payload.faces : []
    const boards: SignFaceBoardFacts[] = []
    for (const raw of rawFaces.slice(0, SIGN_FACE_REQUEST_MAX * 4)) {
      const board = faceOfFacts(raw)
      if (board) boards.push(board)
    }
    if (requestId.length === 0 || boards.length === 0) return true
    const request: SignFaceRequestFacts = {
      requestId,
      revision: typeof envelope.revision === 'number' ? envelope.revision : (typeof payload.revision === 'number' ? payload.revision : -1),
      sessionId: typeof envelope.sessionId === 'string' ? envelope.sessionId : (typeof payload.sessionId === 'string' ? payload.sessionId : ''),
      locale: typeof payload.locale === 'string' ? payload.locale : undefined,
      faces: boards,
    }
    if (disposed) return true
    work = work.then(() => answer(request, boards)).catch(() => {
      // A painter failure must still release the request, or C# would wait forever.
      send('sign.faceReady', readyPayload(request, [], boards.map(board => pendingOf(board, 'unsupported', 'exception')), false))
    })
    return true
  }

  return {
    receive: handle,
    paint(board, locale) {
      return paintBoard(board, signFaceLocale(locale, shellLocale()))
    },
    whenIdle: () => work,
    chunkSize,
    dispose() { disposed = true },
  }
}

/** Test seam: adopt decoded pictogram art (the shipping loader does this itself). */
export function setSignFaceArt(art: Parameters<typeof setPictograms>[0]): void {
  setPictograms(art)
}

/** Font stack the painter uses, so a fixture records the same family. */
export const SIGN_FACE_FONT = CJK_FONT_FAMILY
