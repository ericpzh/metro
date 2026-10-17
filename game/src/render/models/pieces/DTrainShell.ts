import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { registerDoorLeaf, slab } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'
import { DOOR_SILL_Z, DOOR_HEAD_Z } from '../../../sim/stock.ts'
import { PANTOGRAPH_MOUNT_Z, PANTOGRAPH_WELL_HALF_LENGTH } from './TrainPantograph.ts'

export const D_BOTTOM = 0.45
export const D_ROOF = 3.25
export const D_CROWN_HALF = 0.50
const D_BASE_HALF = 0.90
/** Broad continuous arcs carry the head's rounded profile through every car. */
export function dHalfWidth(z: number): number {
  if (z >= 2.30) return D_CROWN_HALF + 1.15 * Math.sqrt(Math.max(0, 1 - ((z - 2.30) / 0.95) ** 2))
  if (z <= 1.05) return D_BASE_HALF + 0.72 * Math.sqrt(Math.max(0, 1 - ((1.05 - z) / 0.60) ** 2))
  const t = THREE.MathUtils.smoothstep(z, 1.05, 1.85)
  return 1.62 + 0.03 * t
}

/** Concentrate shared section vertices at the curved roof and sill turns. */
export function dSideLevel(t: number): number {
  return D_BOTTOM + (D_ROOF - D_BOTTOM) * (1 - Math.cos(t * Math.PI)) / 2
}

export function dSurface(point: (u: number, v: number) => THREE.Vector3, rows = 24, columns = 24, reverse = false): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
    positions.push(...point(i / rows, j / columns).toArray())
    uv.push(j / columns, i / rows)
    if (i < rows && j < columns) {
      const a = i * (columns + 1) + j, b = a + columns + 1
      indices.push(...(reverse ? [a, b, a + 1, a + 1, b, b + 1] : [a, a + 1, b, a + 1, b + 1, b]))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Clockwise cross-section, including the flat crown and underfloor closure. */
export function dSection(v: number): THREE.Vector2 {
  const q = v * 4
  if (q < 1) { const z = dSideLevel(q); return new THREE.Vector2(dHalfWidth(z), z) }
  if (q < 2) return new THREE.Vector2(THREE.MathUtils.lerp(D_CROWN_HALF, -D_CROWN_HALF, q - 1), D_ROOF)
  if (q < 3) { const z = dSideLevel(3 - q); return new THREE.Vector2(-dHalfWidth(z), z) }
  return new THREE.Vector2(THREE.MathUtils.lerp(-D_BASE_HALF, D_BASE_HALF, q - 3), D_BOTTOM)
}

/** Across the crown and down each shoulder, for the cab's wraparound glazing. */
export function dCrown(q: number): THREE.Vector2 {
  const a = Math.abs(q), sign = Math.sign(q)
  if (a <= 0.5) return new THREE.Vector2(q * D_CROWN_HALF * 2, D_ROOF)
  if (a <= 1) {
    const angle = (a - 0.5) * Math.PI
    return new THREE.Vector2(sign * (D_CROWN_HALF + 1.15 * Math.sin(angle)), 2.30 + 0.95 * Math.cos(angle))
  }
  const z = 2.30 - (a - 1) * 2.3
  return new THREE.Vector2(sign * dHalfWidth(z), z)
}

/**
 * A car-side patch between two heights. `steps` is the section sampling the patch
 * is lofted on: the full model uses the cab's own 32 intervals so both sides of a
 * join share chords, while the Low approximation samples fewer rows of the same
 * curve. The patch's own `low`/`high` ends stay exact either way, so a reduced
 * patch still meets its neighbours.
 */
export function dSideGeometry(a: number, b: number, low: number, high: number, side: number, lift = 0, steps = 32): THREE.BufferGeometry {
  const levels = [low]
  for (let i = 1; i < steps; i++) {
    const z = dSideLevel(i / steps)
    if (z > low + 1e-6 && z < high - 1e-6) levels.push(z)
  }
  levels.push(high)
  return dSurface((u, v) => {
    const k = v * (levels.length - 1), index = Math.min(levels.length - 2, Math.floor(k))
    const z = THREE.MathUtils.lerp(levels[index], levels[index + 1], k - index)
    let n = 0
    while (n < 31 && dSideLevel((n + 1) / 32) < z) n++
    const base = dSideLevel(n / 32), next = dSideLevel((n + 1) / 32)
    const width = THREE.MathUtils.lerp(dHalfWidth(base), dHalfWidth(next), (z - base) / (next - base))
    return new THREE.Vector3(THREE.MathUtils.lerp(a, b, u), side * (width + lift), z)
  }, 1, levels.length - 1, side < 0)
}

/** Curved plug doors: single at the cab end, paired elsewhere. */
export function buildDDoor(g: THREE.Group, mats: ModelMaterials, x: number, side: number, width: number, doors: THREE.Mesh[], single: boolean): void {
  // The leaf, its seal and the pane are each a lofted rounded panel: 12 rows by
  // 64 columns full, three by eight at Low — a plug door is 1.3 m tall and reads
  // by its silhouette, so the fine rows cost triangles nobody can see.
  const rounded = (w: number, low: number, height: number, radius: number, lift: number, half = 0, rows = 12, columns = 64) => dSurface((u, v) => {
    const depth = Math.max(0, radius - Math.min(v * height, (1 - v) * height))
    const inset = radius - Math.sqrt(Math.max(0, radius * radius - depth * depth))
    const z = low + v * height
    const edge = w / 2 - inset
    const x = half < 0 ? THREE.MathUtils.lerp(-edge, -0.008, u)
      : half > 0 ? THREE.MathUtils.lerp(0.008, edge, u) : (u - 0.5) * edge * 2
    return new THREE.Vector3(x, side * (dHalfWidth(z) + lift), z)
  }, rows, columns, side < 0)
  // Stationary corner infills close the rectangular opening around the
  // rounded moving leaf, including when the plug door is open.
  for (const top of [false, true]) for (const jamb of [-1, 1]) {
    const infillPoint = (u: number, v: number) => {
      const radius = 0.14
      const z = top ? DOOR_HEAD_Z - radius + v * radius : DOOR_SILL_Z + v * radius
      const depth = top ? z - (DOOR_HEAD_Z - radius) : DOOR_SILL_Z + radius - z
      const inset = radius - Math.sqrt(Math.max(0, radius * radius - depth * depth))
      const edge = width / 2 - inset
      return new THREE.Vector3(x + jamb * THREE.MathUtils.lerp(edge - 0.008, width / 2 + 0.012, u),
        side * (dHalfWidth(z) + 0.014), z)
    }
    const infill = new THREE.Mesh(dSurface(infillPoint, 1, 24, side * jamb < 0), top ? mats.trainDark : mats.trainBody)
    infill.name = top ? 'd-door-upper-corner-infill' : 'd-door-lower-corner-infill'
    setModelDetail(infill, dSurface(infillPoint, 1, 6, side * jamb < 0))
    g.add(infill)
  }
  for (const half of single ? [0] : [-1, 1]) {
    const centre = half * width / 4
    const leaf = new THREE.Mesh(rounded(width - 0.04, DOOR_SILL_Z + 0.015, DOOR_HEAD_Z - DOOR_SILL_Z - 0.03, 0.13, 0.035, half), mats.trainBody)
    leaf.name = single ? 'd-passenger-single-door' : 'd-passenger-double-door'
    leaf.position.x = x
    setModelDetail(leaf, rounded(width - 0.04, DOOR_SILL_Z + 0.015, DOOR_HEAD_Z - DOOR_SILL_Z - 0.03, 0.13, 0.035, half, 3, 8))
    const seal = new THREE.Mesh(rounded(width, DOOR_SILL_Z, DOOR_HEAD_Z - DOOR_SILL_Z, 0.14, 0.023, half), mats.rubber)
    seal.name = 'd-passenger-door-seal'; leaf.add(seal)
    setModelDetail(seal, rounded(width, DOOR_SILL_Z, DOOR_HEAD_Z - DOOR_SILL_Z, 0.14, 0.023, half, 3, 8))
    const paneSeal = new THREE.Mesh(rounded(0.29, 1.23, 1.23, 0.14, 0.048), mats.rubber)
    paneSeal.position.x = centre; leaf.add(paneSeal)
    setModelDetail(paneSeal, rounded(0.29, 1.23, 1.23, 0.14, 0.048, 0, 3, 6))
    const pane = new THREE.Mesh(rounded(0.25, 1.25, 1.19, 0.124, 0.058), mats.trainGlass)
    pane.position.x = centre; pane.name = 'train-door-window'; leaf.add(pane)
    setModelDetail(pane, rounded(0.25, 1.25, 1.19, 0.124, 0.058, 0, 3, 6))
    if (single) slab(leaf, mats.darkSteel, -width * 0.32, side * (dHalfWidth(1.2) + 0.070), 1.2, 0.025, 0.025, 0.34).name = 'd-passenger-door-handle'
    registerDoorLeaf(leaf, half || 1, single ? width + 0.03 : width / 2 + 0.02, doors, side)
    leaf.userData.closedY = 0
    leaf.userData.plugTravel = 0.09
    g.add(leaf)
  }
}

/** A dedicated D car skin: curved flanks, inset individual windows and rolled roof. */
export function buildDCarShell(g: THREE.Group, mats: ModelMaterials, start: number, end: number, runs: Array<[number, number]>, livery: THREE.Material, pantographX?: number): void {
  const sidePatch = (name: string, mat: THREE.Material, a: number, b: number, low: number, high: number, side: number, lift = 0) => {
    const lifted = lift + (mat === mats.trainDark ? 0.008 : 0)
    const mesh = new THREE.Mesh(dSideGeometry(a, b, low, high, side, lifted), mat)
    mesh.name = name
    // The same patch on six section intervals: the arc keeps its silhouette at a
    // sixth of the columns, and both end heights stay exact.
    setModelDetail(mesh, dSideGeometry(a, b, low, high, side, lifted, 6))
    g.add(mesh)
  }
  for (const side of [-1, 1]) {
    sidePatch('d-car-sill', mats.trainBody, start, end, D_BOTTOM, 0.57, side)
    sidePatch('d-car-shoulder', mats.trainBody, start, end, 2.63, D_ROOF, side)
    for (const [a, b] of runs) {
      sidePatch('d-car-lower-skin', mats.trainBody, a, b, 0.57, 1.52, side)
      sidePatch('d-car-window-surround', mats.trainDark, a, b, 1.52, 1.85, side)
      sidePatch('d-car-window-surround', mats.trainDark, a, b, 2.35, 2.63, side)
      // §1.12: two small panes in each inter-door bay; end bays stay painted.
      const panes = a > start + 1e-6 && b < end - 1e-6 ? 2 : 0
      if (!panes) sidePatch('d-car-window-pillar', mats.trainDark, a, b, 1.85, 2.35, side)
      for (let i = 0; i < panes; i++) {
        const x0 = a + (b - a) * i / panes, x1 = a + (b - a) * (i + 1) / panes
        const centre = (x0 + x1) / 2, halfPane = Math.min(0.39, (x1 - x0) / 2 - 0.12)
        sidePatch('d-car-window-pillar', mats.trainDark, x0, centre - halfPane, 1.85, 2.35, side)
        sidePatch('d-car-window', mats.glass, centre - halfPane, centre + halfPane, 1.85, 2.35, side)
        sidePatch('d-car-window-pillar', mats.trainDark, centre + halfPane, x1, 1.85, 2.35, side)
      }
      sidePatch('d-car-livery', livery, a, b, 1.05, 1.16, side, 0.008)
      sidePatch('d-car-gold-line', mats.trainTrim, a, b, 1.01, 1.045, side, 0.008)
    }
  }
  const roofRuns: Array<[number, number]> = pantographX === undefined ? [[start, end]]
    : [[start, pantographX - PANTOGRAPH_WELL_HALF_LENGTH], [pantographX + PANTOGRAPH_WELL_HALF_LENGTH, end]]
  for (const [a, b] of roofRuns) {
    const roof = new THREE.Mesh(dSurface((u, v) => new THREE.Vector3(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(-D_CROWN_HALF, D_CROWN_HALF, v), D_ROOF), 1, 1, true), mats.trainBody)
    roof.name = 'd-car-roof'
    g.add(roof)
  }
  if (pantographX !== undefined) {
    const width = D_CROWN_HALF * 2, length = PANTOGRAPH_WELL_HALF_LENGTH * 2
    const height = D_ROOF - PANTOGRAPH_MOUNT_Z
    slab(g, mats.trainBody, pantographX, 0, PANTOGRAPH_MOUNT_Z - 0.01, length, width, 0.02).name = 'pantograph-roof-well'
    for (const side of [-1, 1]) {
      slab(g, mats.trainBody, pantographX, side * D_CROWN_HALF, (D_ROOF + PANTOGRAPH_MOUNT_Z) / 2, length, 0.02, height)
      slab(g, mats.trainBody, pantographX + side * PANTOGRAPH_WELL_HALF_LENGTH, 0, (D_ROOF + PANTOGRAPH_MOUNT_Z) / 2, 0.02, width, height)
    }
  }
}

/** An enclosed flexible gangway fills the space between adjacent car shells. */
export function buildDGangway(g: THREE.Group, mats: ModelMaterials, centre: number): void {
  const bellowsPoint = (u: number, v: number) => {
    const section = dSection(v)
    const fold = 0.977 + 0.016 * Math.cos(u * Math.PI * 8)
    return new THREE.Vector3(centre + (u - 0.5) * 0.29, section.x * fold, 1.85 + (section.y - 1.85) * fold)
  }
  const bellows = new THREE.Mesh(dSurface(bellowsPoint, 32, 128), mats.rubber)
  bellows.name = 'd-intercar-gangway'
  // Eight rings keep the bellows' three fold crests; 16 columns keep its section.
  setModelDetail(bellows, dSurface(bellowsPoint, 8, 16))
  g.add(bellows)
}
