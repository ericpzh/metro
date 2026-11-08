import * as THREE from 'three'
import { outdoorSurfaceHidden } from '../sim/placement.ts'
import { OUTDOOR_TILE_DETAIL_PX } from '../sim/constants.ts'
import type { Module, StationData } from '../sim/types.ts'
import { StaticInstances } from './staticInstances.ts'
import { outdoorSurfaceCoarseGeometry, outdoorSurfaceGeometry } from './models/pieces/OutdoorSurfaceModel.ts'

// Outdoor paving (草坪 / 人行道) used to be one `Group` + `Mesh` per tile — one
// source object for the equipment batcher, one pick target, one contact blob.
// A real station carries tens of thousands of identical 1 × 1 m tiles: that was
// ~8 KB of JS heap and two scene objects per square metre, while the drawing
// itself was already a handful of instanced batches. This layer builds those
// batches directly from the document. Tiles keep a bare root only for the level
// slice / selection bookkeeping; there is no mesh, no batch source and no blob.

export type SurfaceType = 'sidewalk' | 'lawn'

/** Paving is flat and huge: 64 m buckets keep the instance count sane. */
export const SURFACE_BUCKET_SIZE = 64

/** One visible tile: its transform, for the instanced bucket. */
export interface SurfaceSource {
  id: string
  type: SurfaceType
  /** The storey the tile stands on: 显示其他层 dresses a ghosted storey's paving. */
  level: number
  matrix: THREE.Matrix4
}

/** The slice the paving layer dresses its buckets for. */
export interface SurfaceSlice {
  activeZ: number
  /** 显示其他层, as the slice resolved it; 隐藏UI/剖切 pass `straight`. */
  ghost: boolean
  straight: boolean
  /** The 35% ghost of a base material, cached by the scene's material set. */
  ghostMaterial: (base: THREE.Material) => THREE.Material
}

interface Entry {
  ids: string[]
  level: number
  material: THREE.Material
  mesh: StaticInstances
}

/** Group visible tiles by finish, storey and bucket width, in document order. */
export function surfaceBuckets(sources: readonly SurfaceSource[], bucketSize: number): Map<string, SurfaceSource[]> {
  const buckets = new Map<string, SurfaceSource[]>()
  for (const source of sources) {
    const x = source.matrix.elements[12], y = source.matrix.elements[13]
    // The storey is part of the key: one bucket wears one material, and a ghosted
    // storey's paving needs the 35% ghost while the active storey's needs its own.
    const key = `${source.type}|${source.level}|${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(source)
    else buckets.set(key, [source])
  }
  return buckets
}

/**
 * The visible outdoor sources of one document view: every tile root the level
 * slice kept visible, minus the tiles an exit wellway / ramp opening now covers.
 * `roots` are the bare per-tile roots `ModuleSystem` keeps.
 */
export function visibleSurfaceSources(
  roots: Iterable<THREE.Object3D>,
  data: Pick<StationData, 'cells' | 'modules'>,
): SurfaceSource[] {
  const sources: SurfaceSource[] = []
  for (const root of roots) {
    if (root.userData.surfaceTile !== true || root.visible !== true) continue
    const mod = root.userData.module as Module | undefined
    if (!mod || (mod.type !== 'sidewalk' && mod.type !== 'lawn')) continue
    // The tile's open/unsupported verdict is resolved when its root is built or
    // rebuilt (`retainedModuleIds` invalidates exactly those roots); reading the
    // cached flag keeps a view rebuild from re-querying the station per tile.
    const hidden = root.userData.surfaceHidden ?? outdoorSurfaceHidden(data.cells, data.modules, mod)
    if (hidden) continue
    // `StaticInstances` clones the matrices it instances. Composing the local
    // matrix here is cheaper than walking the parent chain per tile, and a bare
    // tile root never carries a parent transform of its own.
    root.updateMatrix()
    sources.push({ id: mod.id, type: mod.type, level: (root.userData.levelZs as number[] | undefined)?.[0] ?? mod.z, matrix: root.matrix })
  }
  return sources
}

/** The instanced paving layer. Buckets are rebuilt per view change. */
export class SurfaceBatches {
  readonly root = new THREE.Group()
  private entries = new Map<string, Entry>()
  private key: string | null = null
  private material: THREE.Material | null = null
  private sliceKey = ''

  /** Instance meshes the pointer and the section clip walk. */
  meshes(): THREE.Mesh[] {
    return [...this.entries.values()].map(entry => entry.mesh)
  }

  /**
   * Rebuild only when the view key moves: surface edits bump the caller's
   * revision, and a level/hide/quality change moves the key. `slice` decides the
   * material per storey — a ghosted storey's paving is the 35% ghost, matching
   * the per-mesh walk; a tile has no mesh of its own for that walk to dress.
   */
  sync(
    roots: Iterable<THREE.Object3D>,
    data: Pick<StationData, 'cells' | 'modules'>,
    material: THREE.Material,
    bucketSize: number,
    key: string,
    slice: SurfaceSlice,
  ): void {
    const sliceKey = `${slice.activeZ}|${slice.ghost}|${slice.straight}`
    if (this.key === key && this.material === material && this.sliceKey === sliceKey) return
    const materialChanged = this.material !== material
    const previous = this.entries
    this.key = key
    this.material = material
    this.sliceKey = sliceKey
    const buckets = surfaceBuckets(visibleSurfaceSources(roots, data), bucketSize)
    const next = new Map<string, Entry>()
    const reused = new Set<Entry>()
    for (const [bucketKey, sources] of buckets) {
      const ids = sources.map(source => source.id)
      const level = sources[0].level
      const bucketMaterial = slice.straight || level === slice.activeZ ? material
        : slice.ghost ? slice.ghostMaterial(material) : material
      // A tile edit touches one bucket; an unchanged composition keeps its
      // instance buffers and geometry instead of rebuilding every bucket.
      const old = materialChanged ? undefined : previous.get(bucketKey)
      if (old && old.level === level && old.material === bucketMaterial && old.ids.length === ids.length && old.ids.every((id, i) => id === ids[i])) {
        next.set(bucketKey, old)
        reused.add(old)
        continue
      }
      const mesh = new StaticInstances(
        outdoorSurfaceGeometry(sources[0].type),
        bucketMaterial,
        sources.map(source => source.matrix),
        outdoorSurfaceCoarseGeometry(sources[0].type),
        1,
        OUTDOOR_TILE_DETAIL_PX,
      )
      mesh.name = `raised-surface:${bucketKey}`
      mesh.userData.surfaceInstance = true
      mesh.userData.surfaceModuleType = sources[0].type
      mesh.userData.surfaceModuleIds = ids
      next.set(bucketKey, { ids, level, material: bucketMaterial, mesh })
    }
    for (const old of previous.values()) if (!reused.has(old)) this.release(old.mesh)
    this.entries = next
    this.root.clear()
    for (const entry of this.entries.values()) this.root.add(entry.mesh)
  }

  /** Slide LOD geometry against the final draw camera. */
  updateDetail(camera: THREE.Camera, viewportHeight: number): void {
    for (const entry of this.entries.values()) entry.mesh.updateDetail(camera, viewportHeight)
  }

  private release(mesh: StaticInstances): void {
    this.root.remove(mesh)
    mesh.dispose()
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.release(entry.mesh)
    this.entries.clear()
    this.key = null
    this.material = null
  }
}
