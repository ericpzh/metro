// ChunkSystem — the blockwork: station culling prep plus chunk meshing, the
// chunk cache and the dispose discipline (moved verbatim from
// `render/scene.ts`: `setStation`'s culling/meshing passes, `meshBand`,
// `outlineMaterial`, `releaseChunks`, `disposeChunks`).
//
// GAME-SPEC §2 (blocks, storeys on the 4 m grid) and the chunk-cache design
// note in `setStation`: a chunk whose content is unchanged meshes
// byte-identically, so its GPU meshes are reused instead of re-uploaded.

import * as THREE from 'three'
import { buildSolidSet, CHUNK, meshChunk } from '../../chunkMesher.ts'
import { finishDef, finishMapOf } from '../../../sim/finishes.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { trackBedKeys } from '../../../sim/placement.ts'
import { OPENING_CEILING, thinWallCells } from '../../../sim/openings.ts'
import { stairTurnCells } from '../../../sim/stairs.ts'
import { liftFootprintCells, liftStopZs } from '../../../sim/lifts.ts'
import { facilityWallCells } from '../../../build/model.ts'
import { packKey } from '../../../sim/types.ts'
import type { StationData, WallSide } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'

export class ChunkSystem extends SceneSystem {
  levelGroups = new Map<number, THREE.Group>()
  chunkMeshes: THREE.Mesh[] = []
  outlineMeshes: THREE.Mesh[] = []
  /**
   * The same meshes as `outlineMeshes`, as a set. `applyLevel` asks "is this mesh an
   * outline?" once per chunk mesh, and the array answer is a linear scan — so the
   * slice cost grew with the square of the station. Rebuilt with the array.
   */
  outlineSet = new Set<THREE.Mesh>()
  /**
   * Last rebuild's meshed chunk per storey band, keyed `band|cx,cy`, so an edit that
   * touches one block re-meshes one chunk instead of the whole station.
   *
   * A block on a 62×62 three-storey station (the size the lag was reported at) puts
   * ~11k cells through the mesher on every placement — around 108 ms of main thread,
   * which is what made placing a block drop to single-digit FPS. The mesher reads
   * nothing but a chunk's own cells (their exposure, finish and skipped state), so a
   * chunk whose content is unchanged yields byte-identical geometry: reusing the
   * built meshes is not an approximation. The geometry is already on the GPU, so a
   * reuse skips both the meshing and the re-upload.
   *
   * Entries not claimed by the current rebuild are disposed at the end of it, so the
   * cache holds exactly the chunks the station currently has.
   */
  private chunkCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
  /**
   * Cache keys this rebuild intends to reuse, set only around the release call in
   * `setStation` so `releaseChunks` leaves their geometry — and the outline materials
   * that go with it — alone. Null outside that window, when everything is disposable.
   */
  private keepChunkGeometries: Set<string> | null = null
  /**
   * Invisible full-cell boxes standing in for a shop's hidden wall voxels, so a
   * right-click still picks the wall cell (the thin panel is module geometry,
   * which the picking path does not see).
   */
  wallPick = new THREE.Group()
  private wallPickGeo = new THREE.BoxGeometry(1, 1, 1)
  private wallPickMat = new THREE.MeshBasicMaterial({ visible: false })

  constructor(ctx: SceneContext) {
    super(ctx)
    this.ctx.scene.add(this.wallPick)
  }

  /**
   * Station culling prep: the solid set, finishes, track-bed cells, hidden cells
   * (stair landings, shop walls, lift shafts) and thin sides. Everything the
   * mesher, the ghosts and the picking path read about "which cells draw how".
   */
  prepareStation(data: StationData): void {
    this.ctx.solid = buildSolidSet(data.cells)
    this.ctx.finishes = finishMapOf(data.cells)
    this.ctx.stationData = data
    this.ctx.trackCellSet = trackBedKeys(data.cells, data.modules)
    // A stair's turn landing is drawn by the stair model, not the block mesher.
    const solidKeys = new Set<number>()
    for (const c of data.cells) if (c.fill === 'solid') solidKeys.add(packKey(c.x, c.y, c.z))
    this.ctx.hiddenCells = new Set<number>()
    // Every cell that draws half a block thick — a 半墙 the player laid, and every
    // block a ramp kept beside its run (`thinWallCells`) — is **meshed**, not
    // hidden: the mesher draws the half the panel keeps (`meshBand`), so the drawn
    // panel is what the pointer picks and the face a player paints is the face they
    // clicked. Thin cells are collected here because the mesher's own input is a
    // solid set, which cannot say how thick a cell is.
    this.ctx.thinSides = new Map<number, WallSide>()
    for (const t of thinWallCells(data.cells, data.modules)) this.ctx.thinSides.set(packKey(t.x, t.y, t.z), t.side)
    for (const m of data.modules) {
      if (m.type !== 'stair') continue
      for (const p of stairTurnCells(m)) {
        const k = packKey(p.x, p.y, p.z)
        if (solidKeys.has(k)) this.ctx.hiddenCells.add(k)
      }
    }
    // A shop's auto walls are drawn as thin panels by the shop model, so hide
    // their 1 m voxels and leave invisible pick boxes behind: the right-click
    // wall tools still have to find the cell they act on.
    this.wallPick.clear()
    for (const m of data.modules) {
      if (m.type !== 'shop') continue
      for (const [x, y, z] of facilityWallCells(data.cells, m)) {
        const k = packKey(x, y, z)
        if (!solidKeys.has(k)) continue
        this.ctx.hiddenCells.add(k)
        const proxy = new THREE.Mesh(this.wallPickGeo, this.wallPickMat)
        proxy.position.set(x + 0.5, y + 0.5, z + 0.5)
        this.wallPick.add(proxy)
      }
    }
    // A block a ramp runs against is kept, and the mesher draws it half a block
    // thick on the side away from the run (it is in `thinSides` above), so the
    // floor at the top of a stair is not deleted and the run fits beside it. A
    // stair's side floor cells are kept this way too.
    this.wallPick.updateMatrixWorld(true)
    // An elevator passes through the floor slab at every stop above its base:
    // hide those cells so the mesher cuts a real shaft opening (the graph still
    // sees them as nodes, and the cabin supplies the floor). The base cell stays,
    // so the lift stands on solid floor.
    for (const m of data.modules) {
      if (m.type !== 'lift') continue
      const lo = Math.min(m.from.z, m.to.z)
      for (const z of liftStopZs(m.from.z, m.to.z)) {
        if (z <= lo) continue
        for (const [fx, fy] of liftFootprintCells(m)) {
          const k = packKey(fx, fy, z)
          if (solidKeys.has(k)) this.ctx.hiddenCells.add(k)
        }
      }
    }
  }

  /**
   * Mesh every storey band into chunk meshes (the second half of `setStation`).
   * The orchestrator calls `prepareStation` first, then this, then rebuilds
   * modules, the grid and the level slice — in the order the old method did.
   */
  meshStation(data: StationData): void {
    // Give back what the last rebuild left. `disposeChunks` is not used here: it
    // disposes every chunk geometry, and the cache below re-adds the ones whose
    // content did not change. Every geometry the last rebuild made is either
    // re-added from the cache or swept as stale at the end of this pass.
    this.releaseChunks()
    this.ctx.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    // The meshes `applyLevel` assigns materials to have just been replaced, so the
    // slice has to be applied again even if the view state itself did not change.
    this.ctx.levelKey = ''
    const t0 = performance.now()
    this.ctx.lastChunkMs = 0
    // Group cells into storeys. A storey is a floor on the fixed 4 m editing
    // grid (`LEVEL_STEPS`) plus the walls it grows up to the next grid line, so
    // a cell belongs to the storey at or below it (`storeyBand`). Keying by the
    // *grid* rather than by a contiguous run matters: a lower floor's 4 m wall
    // reaches the floor above, and the raw run then reads as one tall storey,
    // merging two floors into a single band. Bands may overlap in z across
    // columns, so each band meshes exactly its own cells (`emit`) instead of a
    // z window.
    const bandOfCell = new Map<number, number>()
    // The lowest storey each column reaches. A block standing on that storey has
    // nothing under it, so it is a plate hanging in space: it must stay on screen
    // even when its storey sits above the one being looked at. Anything with a
    // storey below it is that lower room's ceiling and goes with the cut.
    this.ctx.groundOf.clear()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      const band = storeyBand(c.z)
      bandOfCell.set(packKey(c.x, c.y, c.z), band)
      const col = `${c.x},${c.y}`
      const prev = this.ctx.groundOf.get(col)
      if (prev === undefined || band < prev) this.ctx.groundOf.set(col, band)
    }
    const byBand = new Map<number, { zLo: number; zHi: number; cells: Array<{ x: number; y: number; z: number }> }>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      const band = bandOfCell.get(packKey(c.x, c.y, c.z)) as number
      let entry = byBand.get(band)
      if (!entry) {
        entry = { zLo: c.z, zHi: c.z, cells: [] }
        byBand.set(band, entry)
      }
      if (c.z < entry.zLo) entry.zLo = c.z
      if (c.z > entry.zHi) entry.zHi = c.z
      entry.cells.push({ x: c.x, y: c.y, z: c.z })
    }
    // Solid set of just those unsupported plates, for meshing them on their own.
    // A block a ramp carve orphaned is skipped: it is the ceiling over that
    // opening (tagged by `carveRampOpenings`), so it belongs to the storey below
    // and is cut with it rather than ghosted above the active level.
    const floating = new Set<number>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      if (c.tags?.includes(OPENING_CEILING)) continue
      if (bandOfCell.get(packKey(c.x, c.y, c.z)) === this.ctx.groundOf.get(`${c.x},${c.y}`)) floating.add(packKey(c.x, c.y, c.z))
    }
    const box = new THREE.Box3()
    // Everything the mesher reads for one chunk, hashed. A chunk whose key is
    // unchanged meshes byte-identically, so its last meshes are reused as they are.
    // `isFloat` is part of the key because the same cells are meshed on their own
    // when they are unsupported plates: which pass a chunk belongs to is part of
    // what it draws, and a chunk that changes pass must re-mesh.
    const chunkKey = (levelZ: number, cx: number, cy: number, isFloat: boolean, cells: Array<{ x: number; y: number; z: number }>): string => {
      let h = 2166136261
      let n = 0
      for (const c of cells) {
        const k = packKey(c.x, c.y, c.z)
        if (this.ctx.hiddenCells.has(k)) continue
        h = Math.imul(h ^ c.x, 16777619)
        h = Math.imul(h ^ c.y, 16777619)
        h = Math.imul(h ^ c.z, 16777619)
        // How thick the cell is, and which half it keeps: a 半墙 the player re-tags
        // (or a wall that becomes one) meshes differently at the same coordinates.
        const side = this.ctx.thinSides.get(k)
        if (side !== undefined) h = Math.imul(h ^ side.charCodeAt(0), 16777619)
        const fin = this.ctx.finishes.get(k)
        if (fin) {
          // A custom-tinted finish id is a string; hash its characters, not its object.
          for (const id of [fin.top, fin.bottom, fin.e, fin.w, fin.n, fin.s]) {
            if (id === undefined) continue
            for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
            h = Math.imul(h ^ id.length, 16777619)
          }
        }
        n++
      }
      return `${levelZ}|${isFloat ? 'f' : 's'}|${cx},${cy}|${n}:${h >>> 0}`
    }
    const reuse = new Map(this.chunkCache)
    // Which cached chunks this rebuild will keep, decided **before** anything is
    // released: a reused chunk's `BufferGeometry` must survive the sweep, because a
    // disposed geometry is not re-uploaded and its meshes would draw nothing.
    const keep = new Set<string>()
    {
      const groupByChunk = (list: Array<{ x: number; y: number; z: number }>): Map<string, Array<{ x: number; y: number; z: number }>> => {
        const perChunk = new Map<string, Array<{ x: number; y: number; z: number }>>()
        for (const c of list) {
          const k = `${Math.floor(c.x / CHUNK) * CHUNK},${Math.floor(c.y / CHUNK) * CHUNK}`
          const entry = perChunk.get(k)
          if (entry) entry.push(c)
          else perChunk.set(k, [c])
        }
        return perChunk
      }
      // Mirrors the two passes below exactly, so the keys match.
      for (const [levelZ, band] of byBand) {
        for (const [k, list] of groupByChunk(band.cells)) {
          const [cx, cy] = k.split(',').map(Number)
          const key = chunkKey(levelZ, cx, cy, false, list)
          if (reuse.has(key)) keep.add(key)
        }
        const floats = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
        if (floats.length > 0) {
          for (const [k, list] of groupByChunk(floats)) {
            const [cx, cy] = k.split(',').map(Number)
            const key = chunkKey(levelZ, cx, cy, true, list)
            if (reuse.has(key)) keep.add(key)
          }
        }
      }
    }
    this.keepChunkGeometries = keep
    this.releaseChunks()
    this.ctx.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    this.keepChunkGeometries = null
    const nextCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
    const meshBand = (group: THREE.Group, levelZ: number, cells: Array<{ x: number; y: number; z: number }>, solid: Set<number>, emit: Set<number>, isFloat: boolean): void => {
      // Chunks are grouped once and meshed from that chunk's own cells, rather than
      // walking the whole 16³ volume with an `emit` test per cell: the volume is
      // mostly air, and a band that spans several z levels visited every column for
      // every level in it.
      const byChunk = new Map<string, { cx: number; cy: number; cells: Array<{ x: number; y: number; z: number }> }>()
      for (const c of cells) {
        const cx = Math.floor(c.x / CHUNK) * CHUNK
        const cy = Math.floor(c.y / CHUNK) * CHUNK
        const k = `${cx},${cy}`
        let entry = byChunk.get(k)
        if (!entry) byChunk.set(k, (entry = { cx, cy, cells: [] }))
        entry.cells.push(c)
      }
      for (const { cx, cy, cells: chunkCells } of byChunk.values()) {
        const key = chunkKey(levelZ, cx, cy, isFloat, chunkCells)
        // Unchanged since the last rebuild: keep the meshes, their GPU geometry and
        // their material wiring, and only put them back in the group.
        const keptEntry = keep.has(key) ? reuse.get(key) : undefined
        if (keptEntry) {
          nextCache.set(key, keptEntry)
          for (const m of keptEntry.meshes) {
            group.add(m)
            this.chunkMeshes.push(m)
            if (m.geometry.boundingBox) box.union(m.geometry.boundingBox)
          }
          for (const o of keptEntry.outlines) {
            group.add(o)
            this.outlineMeshes.push(o)
            this.outlineSet.add(o)
          }
          continue
        }
        const chunk = meshChunk(solid, this.ctx.finishes, cx, cy, levelZ, levelZ, emit, this.ctx.hiddenCells, chunkCells, this.ctx.thinSides)
        if (chunk.triangles === 0) continue
        this.ctx.lastChunkMs = Math.max(this.ctx.lastChunkMs, chunk.ms)
        const meshes: THREE.Mesh[] = []
        const outlines: THREE.Mesh[] = []
        // One mesh per finish, sharing the chunk geometry where faces agree.
        for (const part of chunk.parts) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
          geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
          geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3))
          geo.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2))
          geo.setIndex(new THREE.BufferAttribute(part.indices, 1))
          geo.computeBoundingBox()
          if (geo.boundingBox) box.union(geo.boundingBox)
          const mesh = new THREE.Mesh(geo, this.ctx.mats.finish(part.finish))
          mesh.userData.levelZ = levelZ
          mesh.userData.float = isFloat
          mesh.userData.cells = chunkCells.length
          // Tag wall faces so 隐藏墙壁 can fade them (and their outline) alone.
          mesh.userData.wall = finishDef(part.finish).family === 'wall'
          group.add(mesh)
          this.chunkMeshes.push(mesh)
          meshes.push(mesh)
          // Inverted hull outline: same geometry, back faces, pushed outward.
          const outlineMat = this.outlineMaterial()
          const outline = new THREE.Mesh(geo, outlineMat)
          // The outline owns its material, and `baseMaterial` pins the opaque
          // original: without it a second `applyLevel` would take the ghost
          // clone for the base and dim the hull again, and again.
          outline.userData.baseMaterial = outlineMat
          outline.userData.levelZ = levelZ
          outline.userData.float = isFloat
          outline.userData.wall = mesh.userData.wall
          outline.renderOrder = -1
          group.add(outline)
          this.outlineMeshes.push(outline)
          this.outlineSet.add(outline)
          outlines.push(outline)
        }
        if (meshes.length > 0) {
          // Every part's geometry, not just the first: a chunk is one mesh per
          // finish, and keeping the geometry of a reused chunk means keeping all of
          // them — the rest are disposes of in `releaseChunks` otherwise, and a
          // disposed geometry is never re-uploaded.
          nextCache.set(key, { key, meshes, outlines, geometries: meshes.map((m) => m.geometry) })
        }
      }
    }
    for (const [levelZ, band] of byBand) {
      const group = new THREE.Group()
      group.userData.levelZ = levelZ
      // Emit exactly this band's cells: runs overlap in z across columns, so a
      // chunk's z window alone would mesh a neighbouring storey too. Both passes
      // read the same set — the second only meshes the plates with nothing under
      // them — so it is built once and the floating pass is handed the short list
      // of unsupported cells rather than walking the whole storey again.
      const emit = new Set<number>()
      for (const c of band.cells) emit.add(packKey(c.x, c.y, c.z))
      // The whole storey, then its unsupported plates on their own, so the two can
      // be shown separately: a storey below the active level draws whole, while a
      // plate hanging above it still stays on screen.
      meshBand(group, levelZ, band.cells, this.ctx.solid, emit, false)
      const floats = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
      if (floats.length > 0) meshBand(group, levelZ, floats, floating, emit, true)
      this.levelGroups.set(levelZ, group)
      this.ctx.scene.add(group)
    }
    // Whatever the rebuild did not claim is a chunk that no longer exists (or that
    // changed): release its geometry and its per-chunk outline material, or the
    // cache becomes the leak it was meant to avoid. A kept chunk was skipped by
    // `releaseChunks` above and is already back in `nextCache`.
    for (const [key, stale] of reuse) {
      if (nextCache.has(key)) continue
      for (const m of stale.outlines) (m.material as THREE.Material).dispose()
      for (const g of stale.geometries) g.dispose()
    }
    this.chunkCache = nextCache
    this.ctx.bounds = box
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 8))
    const clipY = box.min.y + (box.max.y - box.min.y) * 0.5
    this.ctx.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)
    void t0
  }

  outlineMaterial(): THREE.Material {
    const m = this.ctx.mats.outline.clone()
    m.onBeforeCompile = (shader) => {
      shader.uniforms.outlineWidth = { value: 0.05 }
      shader.vertexShader = 'uniform float outlineWidth;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n transformed += normal * outlineWidth;',
      )
    }
    return m
  }

  disposeChunks(): void {
    this.releaseChunks()
    this.ctx.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    // `dispose()` is the end of the road, so the cache's own references go too — the
    // geometry itself was already released by `releaseChunks` above.
    this.chunkCache.clear()
  }

  /**
   * Release the rebuilt chunk geometry and the per-chunk outline materials, without
   * touching the scene graph or the chunk cache.
   *
   * `setStation` calls this to put down everything the *last* rebuild left, then
   * re-adds from `chunkCache` the chunks whose content did not change — so the
   * geometry here is still wanted by the cache entries, which is why this is split
   * from the cache's own pruning (see the stale sweep in `meshStation`).
   */
  releaseChunks(): void {
    // Geometries are shared between a chunk mesh and its outline mesh, and the
    // surface materials are shared across chunks: only the geometry and the
    // per-chunk outline material are ours to dispose.
    //
    // A chunk the rebuild is about to reuse is skipped: its geometry is handed
    // straight back to a fresh group, and disposing it would drop it from the GPU
    // without a re-upload, so the reused meshes would draw nothing.
    const keep = this.keepChunkGeometries
    const kept = keep ? new Set<THREE.BufferGeometry>() : null
    const keptOutline = keep ? new Set<THREE.Material>() : null
    if (keep) {
      for (const entry of this.chunkCache.values()) {
        if (!keep.has(entry.key)) continue
        for (const g of entry.geometries) kept?.add(g)
        for (const o of entry.outlines) keptOutline?.add(o.material as THREE.Material)
      }
    }
    for (const m of this.chunkMeshes) {
      if (kept?.has(m.geometry)) continue
      m.geometry.dispose()
    }
    for (const m of this.outlineMeshes) {
      const mat = m.material as THREE.Material
      if (keptOutline?.has(mat)) continue
      mat.dispose()
    }
    // The 显示其他层 / 隐藏墙壁 caches are keyed by the very materials just dropped —
    // an outline material is minted per chunk part per rebuild, and a module-local
    // plate material per module. Left alone they grow for the whole session, and
    // each entry pins a material (and, through `Material.clone`, its `map` texture)
    // that nothing else references any more. Dropping what is now unreachable is
    // all this needs: every live material is re-cached on the next `applyLevel`.
    this.ctx.dimMats.clear()
    this.ctx.clearMats.clear()
    this.chunkMeshes = []
    this.outlineMeshes = []
    this.outlineSet = new Set()
  }
}
