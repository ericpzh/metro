// Procedural material detail — PLAN.md §2.3 item 4 and §4.3. No image files,
// no GLB: every finish in `sim/finishes.ts` is drawn into a small canvas at
// load and repeated per metre. The renderer reads the same table the sim reads,
// so a finish cannot look like one thing and behave like another.

import * as THREE from 'three'
import { DEFAULT_FINISH, FINISH_LIST, RAMP_SOFFIT_FINISH, finishDef, type FinishDef } from '../sim/finishes.ts'
import type { FinishId, StationData } from '../sim/types.ts'

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d') as CanvasRenderingContext2D
  return { c, g }
}

function tex(c: HTMLCanvasElement, repeat: number, aniso = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  if (aniso) t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Light speckled granite with the dark inlay band the spec asks for. */
function graniteCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#c9ccd1'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.floor(Math.random() * 90)
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.15 + Math.random() * 0.35})`
    const s = Math.random() < 0.85 ? 1 : 2
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), s, s)
  }
  g.fillStyle = 'rgba(35,38,46,0.85)'
  g.fillRect(0, 60, 128, 4)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(0, 64, 128, 1)
  return c
}

/** Poured concrete — mottled, no inlay. */
function concreteCanvas(colour: number): HTMLCanvasElement {
  const { c, g } = canvas(128)
  const base = new THREE.Color(colour)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1800; i++) {
    const d = Math.random() < 0.5 ? -14 : 12
    const r = Math.max(0, Math.min(255, Math.round(base.r * 255) + d))
    const gg = Math.max(0, Math.min(255, Math.round(base.g * 255) + d))
    const b = Math.max(0, Math.min(255, Math.round(base.b * 255) + d))
    g.fillStyle = `rgba(${r},${gg},${b},0.35)`
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 2, 2)
  }
  return c
}

/** Square floor tile with grout joints. */
function tileCanvas(colour: number): HTMLCanvasElement {
  const { c, g } = canvas(128)
  const base = new THREE.Color(colour)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(90,96,104,0.55)'
  g.lineWidth = 2
  for (let i = 0; i <= 128; i += 64) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, 128)
    g.moveTo(0, i)
    g.lineTo(128, i)
    g.stroke()
  }
  return c
}

/** Track bed — dark ballast / slab. Not walkable (§4.3). */
function trackCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#2c313a'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 2000; i++) {
    const v = 24 + Math.floor(Math.random() * 34)
    g.fillStyle = `rgba(${v},${v},${v + 6},0.7)`
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 2, 2)
  }
  return c
}

/** Flat painted plaster. */
function plasterCanvas(colour: number): HTMLCanvasElement {
  const { c, g } = canvas(64)
  const base = new THREE.Color(colour)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 500; i++) {
    const v = Math.random() < 0.5 ? 0.04 : -0.04
    g.fillStyle = v > 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    g.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 2, 2)
  }
  return c
}

/** Glossy coloured enamel wall panel with visible seams. */
function enamelCanvas(colour: number): HTMLCanvasElement {
  const { c, g } = canvas(128)
  const base = new THREE.Color(colour)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, 0, 128, 128)
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgba(255,255,255,0.22)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.02)')
  grad.addColorStop(1, 'rgba(0,0,0,0.16)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(0,0,0,0.28)'
  g.fillRect(0, 0, 2, 128)
  g.fillRect(0, 0, 128, 2)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(2, 2, 1, 126)
  return c
}

/** White linear baffle ceiling. */
function baffleCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#e8ebef'
  g.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 128; y += 8) {
    g.fillStyle = y % 16 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.35)'
    g.fillRect(0, y, 128, 1)
  }
  g.fillStyle = 'rgba(0,0,0,0.05)'
  g.fillRect(0, 0, 128, 128)
  return c
}

/** Dark soil / world outside. */
function soilCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#232a34'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1400; i++) {
    const v = 26 + Math.floor(Math.random() * 26)
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},0.5)`
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 2, 2)
  }
  return c
}

/** Brushed stainless. */
function metalCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(64)
  g.fillStyle = '#9aa2ab'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 900; i++) {
    const y = Math.floor(Math.random() * 64)
    const v = 140 + Math.floor(Math.random() * 70)
    g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.25)`
    g.fillRect(0, y, 64, 1)
  }
  return c
}

/**
 * Dark brushed steel in the finish's own tint — the 楼梯 / 扶梯 soffit and the ground
 * a truss hangs into. `metalCanvas` is a fixed light stainless, so 钢板 carries its
 * colour in the tint like the concrete and enamel looks do.
 */
function steelCanvas(colour: number): HTMLCanvasElement {
  const { c, g } = canvas(64)
  const r = (colour >> 16) & 0xff
  const gr = (colour >> 8) & 0xff
  const b = colour & 0xff
  g.fillStyle = `rgb(${r},${gr},${b})`
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 900; i++) {
    const y = Math.floor(Math.random() * 64)
    // A lighter brush line over the base, so the plate reads as rolled steel.
    const v = 0.16 + Math.random() * 0.22
    g.fillStyle = `rgba(${Math.min(255, r + 90)},${Math.min(255, gr + 90)},${Math.min(255, b + 92)},${v.toFixed(2)})`
    g.fillRect(0, y, 64, 1)
  }
  return c
}

/** Safety-yellow tactile strip marking the platform edge (§11). */
function tactileCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(64)
  g.fillStyle = '#f7d84b'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(120,96,10,0.55)'
  for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 2, 64)
  g.fillStyle = 'rgba(255,255,255,0.4)'
  for (let x = 2; x < 64; x += 8) g.fillRect(x, 0, 1, 64)
  return c
}

/** Soft radial contact-shadow blob, used under modules and the crowd. */
export function contactShadowTexture(): THREE.Texture {
  const { c, g } = canvas(64)
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.22)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function canvasFor(def: FinishDef): HTMLCanvasElement {
  switch (def.look) {
    case 'granite':
      return graniteCanvas()
    case 'concrete':
      return concreteCanvas(def.tint)
    case 'tile':
      return tileCanvas(def.tint)
    case 'track':
      return trackCanvas()
    case 'baffle':
      return baffleCanvas()
    case 'metal':
    case 'stainless':
      return metalCanvas()
    case 'steel':
      return steelCanvas(def.tint)
    case 'plaster':
      return plasterCanvas(def.tint)
    case 'enamel':
      return enamelCanvas(def.tint)
    case 'soil':
      return soilCanvas()
  }
}

function finishMaterial(def: FinishDef): THREE.MeshStandardMaterial {
  const glossy = def.look === 'metal' || def.look === 'steel' || def.look === 'stainless' || def.look === 'enamel'
  return new THREE.MeshStandardMaterial({
    map: tex(canvasFor(def), 1),
    vertexColors: true,
    // 钢板 is the run's own truss colour: the escalator's dark steel is roughness
    // 0.55 / metalness 0.4 (`PieceBuilder` C.darkSteel), so the filling and the truss
    // it meets read as one surface.
    roughness: def.look === 'enamel' ? 0.22 : def.look === 'steel' ? 0.55 : glossy ? 0.35 : def.look === 'track' ? 0.95 : 0.78,
    metalness: def.look === 'steel' ? 0.4 : glossy ? 0.6 : 0.02,
    side: def.family === 'ceiling' ? THREE.DoubleSide : THREE.FrontSide,
  })
}

export interface MaterialSet {
  /** The material for a finish id (§4.3). Cached. */
  finish: (id: FinishId) => THREE.MeshStandardMaterial
  /** Every finish material built so far, so a caller can test ownership. */
  finishCache: Map<FinishId, THREE.MeshStandardMaterial>
  /**
   * Whether this set minted `mat` — the exact ownership test a caller needs, and
   * the only one that is right for a **preview**: a ghost built this very frame
   * mints the finishes its cells name, and a set of "materials I already knew
   * about" would count them as the ghost's own and then dispose them out from under
   * the cache.
   */
  owns: (mat: THREE.Material) => boolean
  /**
   * Release every finish material the given ids do not cover. A painted colour is
   * a finish of its own (`customFinishId`), minted from a free colour picker, and
   * each one pins a canvas texture — so without this a session that paints many
   * shades keeps every shade's pixels for the whole session.
   */
  retain: (inUse: ReadonlySet<FinishId>) => void
  outline: THREE.MeshBasicMaterial
  blob: THREE.MeshBasicMaterial
  /** Transparent floor-decal layer — tactile strips, §4.2. */
  tactile: THREE.MeshBasicMaterial
  /** @deprecated kept for the lab; use `finish`. */
  platform: THREE.MeshStandardMaterial
  /** Release every material and texture this set owns. */
  dispose: () => void
}

/**
 * Every finish id a station document can draw with: the stock list, the defaults
 * every face falls back to, the ramp soffit, each cell's own per-face overrides,
 * and the finish a 楼梯 carries for its treads.
 */
export function finishesInUse(data: StationData): Set<FinishId> {
  const out = new Set<FinishId>(FINISH_LIST.map((f) => f.id))
  for (const id of Object.values(DEFAULT_FINISH)) out.add(id)
  out.add(RAMP_SOFFIT_FINISH)
  for (const c of data.cells) {
    if (!c.finish) continue
    for (const id of Object.values(c.finish)) if (id) out.add(id)
  }
  for (const m of data.modules) {
    if ((m.type === 'stair' || m.type === 'roof' || m.type === 'pillar') && m.cfg.finish) out.add(m.cfg.finish)
    if (m.type === 'track' && m.cfg.bridgeFinish) out.add(m.cfg.bridgeFinish)
  }
  return out
}

export function createMaterials(): MaterialSet {
  const cache = new Map<FinishId, THREE.MeshStandardMaterial>()
  /** Everything this set minted, for `owns` — including finishes minted after it. */
  const minted = new WeakSet<THREE.Material>()
  const finish = (id: FinishId): THREE.MeshStandardMaterial => {
    let m = cache.get(id)
    if (!m) {
      m = finishMaterial(finishDef(id))
      minted.add(m)
      cache.set(id, m)
    }
    return m
  }
  // Inverted-hull outline: back faces, pushed along the normal, flat dark.
  const outline = new THREE.MeshBasicMaterial({ color: 0x11151c, side: THREE.BackSide })
  const blob = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  })
  const tactile = new THREE.MeshBasicMaterial({
    map: tex(tactileCanvas(), 1, false),
    transparent: true,
    depthWrite: false,
    opacity: 0.95,
  })
  minted.add(outline)
  minted.add(blob)
  minted.add(tactile)
  /** Release one finish material and the canvas texture it wraps. */
  const drop = (m: THREE.MeshStandardMaterial): void => {
    m.map?.dispose()
    m.dispose()
  }
  return {
    finish,
    finishCache: cache,
    owns: (mat) => minted.has(mat),
    retain: (inUse) => {
      for (const [id, m] of [...cache]) {
        if (inUse.has(id)) continue
        drop(m)
        cache.delete(id)
      }
    },
    outline,
    blob,
    tactile,
    platform: finish('floor.granite'),
    dispose: () => {
      for (const m of cache.values()) drop(m)
      cache.clear()
      // `platform` is a cache entry (`floor.granite`), so it has already gone with
      // the rest; these three are the set's own.
      outline.dispose()
      blob.map?.dispose()
      blob.dispose()
      tactile.map?.dispose()
      tactile.dispose()
    },
  }
}
