// A rendering pass for concept sheet 03, on demand from a page.
//
// Sheet 03 is about the **block**, and the only honest way to draw a block the way
// the game draws it is to let the game draw it: every picture on that sheet comes
// out of this pass, which meshes real cells with the game's own chunk mesher
// (`render/chunkMesher.ts`) and renders them with the game's own finish materials
// (`render/materials.ts`). So the square rim, the flush seam between two
// blocks and the procedural textures are the ones a player sees, rather than a
// drawing of them that has to be kept in step by hand.
//
// Why a page and not Node: half of what a block looks like is a canvas the game
// paints at runtime — speckled granite with its dark inlay band, glossy enamel
// with its seams, the white baffle ceiling, brushed stainless — and the pass ends
// in `WebGLRenderer.render`. Re-drawing any of it in Node means re-implementing
// the material, the light rig and the tone mapping as well, which is where every
// drift between a sheet and the game so far came from.
//
// The **material table** is read from `sim/finishes.ts`, the same list the rail's
// 材质 folder draws, and returned beside the pixels: the sheet prints the values
// the simulation obeys, so a finish cannot be tuned without the sheet following.
//
// `tools/render-block-cards.mjs` drives this headlessly: it boots the built game
// at `?capture-blocks`, asks for the sheet's frames, and embeds what comes back in
// `art/03-block-system.svg`. It ships in the game's own bundle, so it is guarded —
// nothing happens unless the query flag is present and the caller asks.

import * as THREE from 'three'
import { addStationLights, applyStationRenderer } from '../render/scene/lightRig.ts'
import { meshChunk } from '../render/chunkMesher.ts'
import { createMaterials } from '../render/materials.ts'
import { finishPaletteGroups } from '../sim/finishes.ts'
import { packKey } from '../sim/types.ts'
import type { CellShape, Face, FinishId } from '../sim/types.ts'

/** The isometric direction the game opens on (`SceneRenderer.setPreset('iso')`). */
const ISO = new THREE.Vector3(1, -1.2, 0.85).normalize()
/**
 * The same angle from **below**. A block's bottom face is the one face no
 * isometric view can see, and it is a face with a meaning of its own (the
 * ceiling finish), so the sheet shows the same block from underneath as well.
 */
const BELOW = new THREE.Vector3(1, -1.2, -0.85).normalize()
/**
 * A **三角** is sawn across the cell, so the shape that names it is its triangular
 * end. Looking mostly down the run's own ridge puts that end face-on with the slope
 * falling away beside it, where the isometric angle would show the slope alone and
 * the piece would read as a tilted plate.
 */
const WEDGE = new THREE.Vector3(1, -0.9, 0.22).normalize()

/** A cell of one specimen, in cell coordinates. */
interface CellAt {
  x: number
  y: number
  z: number
}

/** One block arrangement the sheet photographs, and how to look at it. */
interface BlockScene {
  cells: CellAt[]
  /** Cells among them that draw as less than a whole block (`CellShape`). */
  thin?: Map<number, CellShape>
  /** Per-face finish overrides, by packed cell key. Everything else is the game's default. */
  finish?: Map<number, Partial<Record<Face, FinishId>>>
  /** The direction the piece is seen *from*; `ISO` unless said otherwise. */
  from?: THREE.Vector3
  /** Points worth labelling on the sheet, in cell units — projected on the way out. */
  anchors?: Record<string, [number, number, number]>
}

/** A flat rectangle of cells at one level, starting at the origin. */
function slab(w: number, d: number, z: number): CellAt[] {
  const out: CellAt[] = []
  for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) out.push({ x, y, z })
  return out
}

/** Every face of a cell in one finish. */
const allFaces = (id: FinishId): Partial<Record<Face, FinishId>> => ({
  top: id,
  bottom: id,
  n: id,
  e: id,
  s: id,
  w: id,
})

/**
 * The specimens the sheet shows, by id.
 *
 * Every one of them is a shape the game's own 方块 tool lays: a plain cell, a run
 * of them, a **半墙** panel, either way a cell is sawn on its 45° plane
 * (`CUT_MODES`), and a small room wearing three families of finish at once.
 */
function scenes(): Record<string, BlockScene> {
  // The block's own six faces, for the leaders on the sheet: the cell occupies
  // (0,0,0)…(1,1,1), so these are its faces' centres.
  const blockAnchors: Record<string, [number, number, number]> = {
    top: [0.5, 0.5, 1],
    bottom: [0.5, 0.5, 0],
    east: [1, 0.5, 0.5],
    south: [0.5, 0, 0.5],
    west: [0, 0.5, 0.5],
    north: [0.5, 1, 0.5],
  }

  // Three 半墙 courses along +x, panel hugging the north side of each cell.
  const half = new Map<number, CellShape>()
  for (let x = 0; x < 3; x++) half.set(packKey(x, 0, 0), { kind: 'half', side: 'n' })

  const blocks: BlockScene = { cells: [{ x: 0, y: 0, z: 0 }], anchors: blockAnchors }

  // A room: a granite floor slab (the default top face), an enamel wall along the
  // north edge and a plaster one along the west, both two courses high. Every face
  // of a wall cell wears the wall's own finish, so the courses read as one mass
  // rather than wearing a granite lid.
  const roomCells = slab(3, 3, 0)
  const roomFinish = new Map<number, Partial<Record<Face, FinishId>>>()
  for (let x = 0; x < 3; x++) {
    for (let z = 1; z <= 2; z++) {
      roomCells.push({ x, y: 2, z })
      roomFinish.set(packKey(x, 2, z), allFaces('wall.enamel'))
    }
  }
  for (let y = 0; y < 2; y++) {
    for (let z = 1; z <= 2; z++) {
      roomCells.push({ x: 0, y, z })
      roomFinish.set(packKey(0, y, z), allFaces('wall.plaster'))
    }
  }

  return {
    block: blocks,
    'block-below': { cells: blocks.cells, from: BELOW, anchors: blockAnchors },
    floor: { cells: slab(3, 3, 0) },
    half: { cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], thin: half },
    'tri-upper': {
      cells: [{ x: 0, y: 0, z: 0 }],
      thin: new Map([[packKey(0, 0, 0), { kind: 'triangle', triangle: 'upper', side: 'n' }]]),
      from: WEDGE,
    },
    'tri-lower': {
      cells: [{ x: 0, y: 0, z: 0 }],
      thin: new Map([[packKey(0, 0, 0), { kind: 'triangle', triangle: 'lower', side: 'n' }]]),
      from: WEDGE,
    },
    room: { cells: roomCells, finish: roomFinish },
  }
}

/* ------------------------------------------------------- what the sheet asks for */

export interface BlockFrame {
  id: string
  width: number
  height: number
  background?: string
}

export interface BlockPiece {
  id: string
  /** What the specimen is called: the 方块 tool's own name for the shape. */
  label: string
  /** The line under it. */
  note: string
}

/** A rendered picture, and the points on it a leader may land on. */
export interface CapturedBlock {
  id: string
  width: number
  height: number
  png: string
  /** Named points, in 0..1 of the frame: `top`, `east`, `north`, … Empty when none apply. */
  anchors: Record<string, [number, number]>
}

/**
 * The specimens the sheet shows, in the order it reads them, each with the frame
 * its picture wants. The order is the argument the sheet makes: the cell, the same
 * cell from below, what a run of them merges into, then the three cut pieces.
 */
const SHOW: ReadonlyArray<{ id: string; label: string; note: string; width: number; height: number }> = [
  { id: 'block', label: '一个方块 = 一个格', note: '1 × 1 × 1 米，六个面各带一种材质', width: 208, height: 180 },
  { id: 'block-below', label: '同一个方块，从下面看', note: '底面  →  天花板', width: 208, height: 180 },
  { id: 'floor', label: '3 × 3 地面', note: '相邻的面不画，九个顶面是一整片', width: 296, height: 196 },
  { id: 'half', label: '半墙', note: '同一米，半个格厚，剩下半格能放东西', width: 240, height: 176 },
  { id: 'tri-upper', label: '上三角块', note: '45° 锯开，平面留在地上', width: 188, height: 168 },
  { id: 'tri-lower', label: '下三角块', note: '45° 锯开，平面贴在天花上', width: 188, height: 168 },
  { id: 'room', label: '三种材质同时在场', note: '花岗岩地面 · 涂料墙 · 搪瓷板墙', width: 300, height: 208 },
]

/** One finish, as the rail's 材质 folder files it and as the simulation reads it. */
export interface FinishRow {
  id: string
  label: string
  /** `floor` / `track` / `ceiling` / `wall` — what the finish is *for*. */
  family: string
  /** The palette block the rail files it under (`PaintFolder`). */
  group: string
  /** Walk-speed multiplier on a top face. 0 = not walkable. */
  speed: number
  /** Rain cover, cosmetic in the base game. */
  cover: boolean
  /** The tile's own colour, as the rail paints it. */
  tint: string
}

/**
 * The finish table, in the rail's own order and grouping.
 *
 * Read straight from `sim/finishes.ts`, so the sheet's palette is the game's
 * palette: a finish added, renamed or retuned appears here without an edit, and a
 * value printed on the sheet is a value the simulation obeys.
 */
export function finishTable(): FinishRow[] {
  const out: FinishRow[] = []
  for (const { label, items } of finishPaletteGroups()) {
    for (const f of items) {
      out.push({
        id: f.id,
        label: f.label,
        family: f.family,
        group: label,
        speed: f.speed,
        cover: f.cover,
        tint: `#${f.tint.toString(16).padStart(6, '0')}`,
      })
    }
  }
  return out
}

/** The sheet's frames and the text each picture wears. */
export function blockPieces(background = '#0d141d', scale = 1): { frames: BlockFrame[]; pieces: BlockPiece[] } {
  const frames: BlockFrame[] = []
  const pieces: BlockPiece[] = []
  for (const show of SHOW) {
    frames.push({
      id: show.id,
      width: Math.round(show.width * scale),
      height: Math.round(show.height * scale),
      background,
    })
    pieces.push({ id: show.id, label: show.label, note: show.note })
  }
  return { frames, pieces }
}

/* ------------------------------------------------------------------ the pass */

/**
 * Render every requested frame, in the order asked.
 *
 * Each picture is its own render: the mesher is cheap, the materials are minted
 * once and shared, and a canvas per frame only has to be resized. Frames come back
 * at **twice** the size asked for — the sheet embeds a 2× image into a 1× box and
 * lets the browser downsample it, which is what keeps a block's edge and a
 * granite speckle clean.
 */
export async function captureBlockCards(
  frames: BlockFrame[],
  onProgress?: (done: number, total: number) => void,
): Promise<CapturedBlock[]> {
  const out: CapturedBlock[] = []
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  // Supersampled, but not by the 2× the rail's small square tiles use: a block is
  // shot much larger than a tile, and a granite finish is high-entropy enough that
  // 2× of a 3 × 3 floor would be most of the sheet's weight on its own.
  renderer.setPixelRatio(1.5)
  applyStationRenderer(renderer)

  // The station's own rig: a block on this sheet is lit exactly like the block under
  // the pointer in the game.
  const scene = new THREE.Scene()
  addStationLights(scene)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  // The world is Z-up (see `SceneRenderer`), so the camera must be too — otherwise
  // the blocks render lying on their side and no face ends up where it should be.
  camera.up.set(0, 0, 1)

  const materials = createMaterials()
  const spec = scenes()
  let done = 0

  try {
    for (const frame of frames) {
      const s = spec[frame.id]
      if (!s) continue

      const solid = new Set<number>()
      for (const c of s.cells) solid.add(packKey(c.x, c.y, c.z))
      // The mesher is the game's: same square profile from the same neighbour exposure,
      // same flush seam where two cells share a side.
      const chunk = meshChunk(solid, s.finish ?? new Map(), 0, 0, 0, 3, undefined, undefined, s.cells, s.thin)
      if (!chunk.parts.length) continue

      const group = new THREE.Group()
      const box = new THREE.Box3()
      for (const part of chunk.parts) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
        // Per-vertex ambient occlusion, the same channel the scene draws through
        // `vertexColors` — so a block's corners are as closed as they are in play.
        geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3))
        geo.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2))
        geo.setIndex(new THREE.BufferAttribute(part.indices, 1))
        geo.computeBoundingBox()
        if (geo.boundingBox) box.union(geo.boundingBox)
        group.add(new THREE.Mesh(geo, materials.finish(part.finish)))
      }

      renderer.setSize(frame.width, frame.height, false)
      renderer.setClearColor(frame.background ?? '#0d141d', 1)

      // Frame the piece itself. The eight corners of the mesh's own box are
      // projected into camera space and the largest half-extent wins, so the
      // picture is the piece and the margin is the padding — not a guess at a
      // bounding sphere, which for a flat 3 × 3 floor would be mostly empty frame.
      const aim = box.getCenter(new THREE.Vector3())
      const dir = s.from ?? ISO
      camera.position.copy(aim).addScaledVector(dir, 40)
      camera.lookAt(aim)
      camera.updateMatrixWorld(true)
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

      const aspect = frame.height > 0 ? frame.width / frame.height : 1
      let mx = 0
      let my = 0
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(camera.matrixWorldInverse)
        mx = Math.max(mx, Math.abs(v.x))
        my = Math.max(my, Math.abs(v.y))
      }
      const PAD = 1.06
      const halfH = Math.max(my, mx / aspect) * PAD
      const halfW = halfH * aspect
      camera.left = -halfW
      camera.right = halfW
      camera.top = halfH
      camera.bottom = -halfH
      camera.near = 0.01
      camera.far = 200
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)

      // The leaders the sheet draws land on the piece itself: a face's centre is
      // projected through the very camera that rendered the picture, so a label
      // cannot drift off the surface it names when a frame changes shape.
      const anchors: Record<string, [number, number]> = {}
      for (const [name, at] of Object.entries(s.anchors ?? {})) {
        const p = new THREE.Vector3(at[0], at[1], at[2]).project(camera)
        anchors[name] = [(p.x + 1) / 2, (1 - p.y) / 2]
      }

      scene.add(group)
      renderer.render(scene, camera)
      out.push({
        id: frame.id,
        width: frame.width,
        height: frame.height,
        png: renderer.domElement.toDataURL('image/png'),
        anchors,
      })

      scene.remove(group)
      for (const child of group.children) (child as THREE.Mesh).geometry.dispose()
      onProgress?.(++done, frames.length)
    }
  } finally {
    // The finish materials are the pass's own (each wraps a canvas texture it
    // minted), and nothing outside this pass shares them.
    materials.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return out
}
