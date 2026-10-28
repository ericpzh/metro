// ChunkSystem — the blockwork: station culling prep plus chunk meshing, the
// chunk cache and the dispose discipline (moved verbatim from
// `render/scene.ts`: `setStation`'s culling/meshing passes, `meshBand`,
// `outlineMaterial`, `releaseChunks`, `disposeChunks`).
//
// GAME-SPEC §2 (blocks, storeys on the 5 m grid) and the chunk-cache design
// note in `setStation`: a chunk whose content is unchanged meshes
// byte-identically, so its GPU meshes are reused instead of re-uploaded.

import * as THREE from 'three'
import { platformBlockInsets, type BlockInset } from '../../platformBlockInsets.ts'
import { buildSolidSet, CHUNK, meshChunk } from '../../chunkMesher.ts'
import type { ChunkGeometry } from '../../chunkMesher.ts'
import { finishDef, finishMapOf } from '../../../sim/finishes.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { GROUND_Z, withGround, groundWindow } from '../../../sim/ground.ts'
import { trackBedKeys, moduleEnvelope } from '../../../sim/placement.ts'
import { OPENING_CEILING, rampFillKeys, rampSlopeCuts, thinWallCells } from '../../../sim/openings.ts'
import { stairTurnCells } from '../../../sim/stairs.ts'
import { liftFootprintCells, liftLevels } from '../../../sim/lifts.ts'
import { facilityWallCells } from '../../../build/model.ts'
import { packKey } from '../../../sim/types.ts'
import type { Cell, CellShape, StationData } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import { coarseGeometry } from '../../geometryDetail.ts'
import { ceilingCells } from '../../ceilingCells.ts'
import { localCellEdit } from '../../localCellEdit.ts'
import { changedCellRecords } from '../../cellChanges.ts'

/**
 * A small order-stable number for one cut shape, for the chunk content hash: the
 * mesher draws different geometry for a 半墙's four sides and a 三角's eight
 * wedges, so a chunk whose cell is re-tagged at the same coordinates must re-mesh.
 */
function shapeKey(shape: CellShape): number {
  const family = shape.kind === 'half' ? 0 : shape.triangle === 'upper' ? 1 : 2
  const corner = shape.side.charCodeAt(0) * 31 + (shape.side.length > 1 ? shape.side.charCodeAt(1) : 0)
  return family * 1000 + corner
}

/**
 * Which of the three passes a chunk's meshes came from: `s` the storey's own
 * cells, `f` the plates among them with nothing under them, `g` the street window
 * (`sim/ground.ts`). It is part of the chunk's cache key **and** of what the
 * meshes are tagged with — a plate survives 隐藏天花板, the street is the one plate
 * 隐藏地面 takes away whole (`LevelSystem.applyLevel`).
 */
type ChunkPass = 's' | 'f' | 'g' | 'c'
const chunkColumn = (x: number,y: number): number => packKey(Math.floor(x/CHUNK)*CHUNK,Math.floor(y/CHUNK)*CHUNK,0)
const columnHalo = [-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>[dx,dy]))
// Ceiling classification reads the next column; face/AO emission then reads
// that classification from its neighbour. The composed dependency is two cells.
const classificationHalo = [-2,-1,0,1,2].flatMap(dx=>[-2,-1,0,1,2].map(dy=>[dx,dy]))

export class ChunkSystem extends SceneSystem {
  private platformInsets = new Map<number, BlockInset>()
  private preparedInsets: readonly StationData['modules'][number][] | null = null
  private preparedRamps: readonly StationData['modules'][number][] | null = null
  private readonly details = new Map<THREE.Mesh, { near: THREE.BufferGeometry; raycast: THREE.Mesh['raycast'] }>()

  /** Shared chunk/outline geometry remains owned by the full mesh cache. */
  setGeometryDetail(mesh: THREE.Mesh, reduced: boolean): void {
    let entry = this.details.get(mesh)
    if (!entry) {
      entry = { near: mesh.geometry, raycast: mesh.raycast }
      const source = entry
      mesh.raycast = function (ray, hits) {
        const drawing = this.geometry
        this.geometry = source.near
        try { source.raycast.call(this, ray, hits) } finally { this.geometry = drawing }
      }
      this.details.set(mesh, entry)
    }
    mesh.geometry = reduced ? coarseGeometry(entry.near) ?? entry.near : entry.near
  }
  levelGroups = new Map<number, THREE.Group>()
  chunkMeshes: THREE.Mesh[] = []
  outlineMeshes: THREE.Mesh[] = []
  /**
   * The same meshes as `outlineMeshes`, as a set. `applyLevel` asks "is this mesh an
   * outline?" once per chunk mesh, and the array answer is a linear scan — so the
   * slice cost grew with the square of the station. Rebuilt with the array.
   */
  outlineSet = new Set<THREE.Mesh>()
  readonly retainedLevelMeshes=new Set<THREE.Mesh>()
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
   * The one thing the mesher reads from beyond a cell's own record is the **derived
   * filling** a block carries up to a run's truss (`slopeFills`): it is decided by the
   * block directly below — the same column and the same storey band, so the same chunk
   * — and by the cut the chunk key already hashes.
   *
   * Entries not claimed by the current rebuild are disposed at the end of it, so the
   * cache holds exactly the chunks the station currently has.
   */
  private chunkCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
  private meshedGroundWindow: ReturnType<typeof groundWindow> | null = null
  private groundTopology = 0
  private localChunks: Set<number> | null = null
  private localLevels: Set<number> | null = null
  private localBands: Map<number, Set<number> | null> | null = null
  private groundWindowOnly=false
  private ceilingKeys=new Set<number>()
  private cellsByChunk = new Map<number, Map<number, Cell[]>>()
  private chunkOrigins = new Map<number, [number,number]>()
  private indexEffectiveCells(columns?: ReadonlySet<number>): void {
    if(columns){
      if(!columns.size)return
      for(const column of columns)this.cellsByChunk.delete(column)
    }else{
      this.cellsByChunk.clear()
      this.chunkOrigins.clear()
    }
    for(const c of this.effectiveCells){
      const column=chunkColumn(c.x,c.y)
      if(columns&&!columns.has(column))continue
      this.chunkOrigins.set(column,[Math.floor(c.x/CHUNK)*CHUNK,Math.floor(c.y/CHUNK)*CHUNK])
      let bucket=this.cellsByChunk.get(column)
      if(!bucket)this.cellsByChunk.set(column,bucket=new Map())
      const key=packKey(c.x,c.y,c.z),records=bucket.get(key)
      if(records)records.push(c);else bucket.set(key,[c])
    }
  }
  chunkKeyCellVisits = 0
  meshedCellVisits = 0
  groundTemplateHits = 0
  private readonly groundTemplates = new Map<string, ChunkGeometry>()
  /** Plain pavement repeats exactly between chunk columns. Prove the complete
   * mesher halo before sharing CPU geometry; holes, cuts and authored support
   * keep the ordinary mesher. GPU buffers retain their existing ownership. */
  private plainGround(cells: Array<{x:number;y:number;z:number}>,cx:number,cy:number,w:ReturnType<typeof groundWindow>,build:()=>ChunkGeometry):ChunkGeometry {
    const fallback=()=>{this.meshedCellVisits+=cells.length;return build()}
    if(!cells.length||cells.some(c=>c.z!==GROUND_Z||!Number.isInteger(c.x)||!Number.isInteger(c.y)||!this.groundKeys.has(packKey(c.x,c.y,c.z))))return fallback()
    const x0=Math.min(...cells.map(c=>c.x)),x1=Math.max(...cells.map(c=>c.x)),y0=Math.min(...cells.map(c=>c.y)),y1=Math.max(...cells.map(c=>c.y))
    if(cells.length!==(x1-x0+1)*(y1-y0+1))return fallback()
    for(let x=x0-1;x<=x1+1;x++)for(let y=y0-1;y<=y1+1;y++){
      const k=packKey(x,y,GROUND_Z)
      if(this.ctx.solid.has(k)!==(x>=w.x0&&x<=w.x1&&y>=w.y0&&y<=w.y1)||
        x>=x0&&x<=x1&&y>=y0&&y<=y1&&!this.groundKeys.has(k)||this.ctx.finishes.has(k)||
        this.ctx.hiddenCells.has(k)||this.ctx.thinSides.has(k)||this.ctx.slopeCuts.has(k)||this.ctx.slopeFills.has(k)||this.platformInsets.has(k))return fallback()
      for(let dz=-1;dz<=2;dz++)if(dz&&
        (this.ctx.solid.has(packKey(x,y,GROUND_Z+dz))||this.ctx.slopeFills.has(packKey(x,y,GROUND_Z+dz))))return fallback()
    }
    const key=[x0-cx,x1-cx,y0-cy,y1-cy,Math.max(cx-1,w.x0)-cx,Math.min(cx+CHUNK,w.x1)-cx,Math.max(cy-1,w.y0)-cy,Math.min(cy+CHUNK,w.y1)-cy].join(',')
    const cached=this.groundTemplates.get(key)
    if(!cached){
      const result=fallback()
      if(this.groundTemplates.size>=64)this.groundTemplates.delete(this.groundTemplates.keys().next().value!)
      this.groundTemplates.set(key,{...result,parts:result.parts.map(part=>{
        const positions=part.positions.slice()
        for(let i=0;i<positions.length;i+=3){positions[i]-=cx;positions[i+1]-=cy}
        return {...part,positions}
      })})
      return result
    }
    this.groundTemplateHits++
    return {...cached,ms:0,parts:cached.parts.map(part=>{
      const positions=part.positions.slice()
      for(let i=0;i<positions.length;i+=3){positions[i]+=cx;positions[i+1]+=cy}
      return {...part,positions}
    })}
  }
  private localMeshGeneration = 0
  /**
   * The effective cell list of the last `prepareStation`: the document's own
   * cells plus the generated street window (`withGround`). `meshStation` meshes
   * exactly this, so the drawn ground and the walked ground are one list.
   */
  private effectiveCells: Cell[] = []
  /**
   * The keys of the generated street cells (`withGround`): every effective cell
   * the document does not hold. The street is the one surface the player can take
   * away whole (隐藏地面), so it is meshed as **its own pass** and tagged
   * (`ground`) rather than mixed into its storey's band with the blocks the
   * document owns — which is what makes the toggle a `visible` flag instead of a
   * rebuild. It is also why the plane is meshed once: emitted by the storey pass
   * *and* by the unsupported-plate pass, every street cell used to be built twice.
   */
  private groundKeys = new Set<number>()
  private readonly authoredKeys=new WeakMap<readonly Cell[],Set<number>>()
  private ownedKeys(cells:readonly Cell[]):Set<number>{
    let keys=this.authoredKeys.get(cells)
    if(!keys){keys=new Set(cells.map(c=>packKey(c.x,c.y,c.z)));this.authoredKeys.set(cells,keys)}
    return keys
  }
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
   *
   * `effective` is the `withGround` list the caller already built for the same
   * document (the viewport's live sets): reusing it saves a second window-wide
   * materialisation per commit. Omitted callers (tests, `/lab`) build it here.
   */
  prepareStation(data: StationData, effective?: Cell[], groundOnly = false): void {
    this.localChunks = null
    this.localLevels = null
    this.localBands = null
    this.groundWindowOnly=false
    const previous=this.ctx.stationData
    // Structural edits still prepare the exact complete derived state. Afterwards
    // compare those inputs so remote chunk caches need no station-wide rehash.
    const structural = !groundOnly && previous && this.chunkCache.size > 0 &&
      previous.levelBase === data.levelBase && previous.storeyHeight === data.storeyHeight &&
      this.onlyPreparedModulesChanged(previous, data) ? {
        cells: this.effectiveCells, ground: this.groundKeys, solid: this.ctx.solid,
        hidden: this.ctx.hiddenCells, finishes: this.ctx.finishes, thin: this.ctx.thinSides,
        cuts: this.ctx.slopeCuts, fills: this.ctx.slopeFills, insets: this.platformInsets,
      } : null
    const edit=previous && effective && localCellEdit(previous,data)
    // A local block edit cannot alter cuts/hidden walls away from structural
    // modules. Those edits still take the complete preparation path.
    if(edit && new Set(edit.added.map(c=>packKey(c.x,c.y,c.z))).size===edit.added.length &&
      ![...edit.removed,...edit.added].some(c=>(this.cellsByChunk.get(chunkColumn(c.x,c.y))?.get(packKey(c.x,c.y,c.z))?.length??0)>1) &&
      ![...edit.removed,...edit.added].some(c=>c.finish?.top==='floor.track'||data.modules.some(m=>{
      if(m.type!=='shop')return false
      const box=moduleEnvelope(m)
      return !box || c.z>=box.z0-1&&c.z<=box.z1+1&&c.x>=box.x0-3&&c.x<=box.x1+3&&c.y>=box.y0-3&&c.y<=box.y1+3
    }))){
      this.localChunks=new Set()
      this.localLevels=new Set()
      this.localBands=new Map()
      for(const c of [...edit.removed,...edit.added])for(const [dx,dy]of classificationHalo)
      {
        const x=Math.floor((c.x+dx)/CHUNK)*CHUNK,y=Math.floor((c.y+dy)/CHUNK)*CHUNK
        const column=chunkColumn(x,y)
        this.localChunks.add(column);this.chunkOrigins.set(column,[x,y])
        let bands=this.localBands.get(column)
        if(!bands)this.localBands.set(column,bands=new Set())
        for(let dz=-2;dz<=1;dz++)bands.add(storeyBand(c.z+dz,this.ctx.levelBase,this.ctx.storeyHeight))
      }
      for(const c of [...edit.removed,...edit.added])for(let dz=-2;dz<=1;dz++)this.localLevels.add(storeyBand(c.z+dz,this.ctx.levelBase,this.ctx.storeyHeight))
      for(const c of edit.removed){const k=packKey(c.x,c.y,c.z);this.ctx.solid.delete(k);this.ctx.finishes.delete(k)}
      // meshStation compares the old column floor with the new one. Keep the
      // old value until then: clearing it here would widen every deletion to
      // all vertical bands even when its supporting floor stays unchanged.
      for(const c of edit.added)if(c.fill==='solid')this.ctx.solid.add(packKey(c.x,c.y,c.z))
      for(const [k,v]of finishMapOf(edit.added))this.ctx.finishes.set(k,v)
      for(const c of edit.removed)this.cellsByChunk.get(chunkColumn(c.x,c.y))?.delete(packKey(c.x,c.y,c.z))
      for(const c of edit.added){
        const column=chunkColumn(c.x,c.y)
        let bucket=this.cellsByChunk.get(column)
        if(!bucket)this.cellsByChunk.set(column,bucket=new Map())
        bucket.set(packKey(c.x,c.y,c.z),[c])
      }
      for(const c of edit.removed)this.ctx.thinSides.delete(packKey(c.x,c.y,c.z))
      for(const c of thinWallCells(edit.added,data.modules))this.ctx.thinSides.set(packKey(c.x,c.y,c.z),c.shape)
      this.ctx.slopeFills=rampFillKeys(this.ctx.solid,this.ctx.slopeCuts)
      // Turn landings and lift holes derive membership from the edited solids.
      // Shop wall proxies stay untouched (nearby shop edits take the full path).
      for(const m of data.modules){
        const points=m.type==='stair'?stairTurnCells(m):m.type==='lift'?liftLevels(m).filter(z=>z>Math.min(m.from.z,m.to.z)).flatMap(z=>liftFootprintCells(m).map(([x,y])=>({x,y,z}))):[]
        for(const c of points){if(!Number.isInteger(c.z))continue;const k=packKey(c.x,c.y,c.z);if(this.ctx.solid.has(k))this.ctx.hiddenCells.add(k);else this.ctx.hiddenCells.delete(k)}
      }
      this.effectiveCells=effective!
      this.ctx.stationData=data
      return
    }
    if (groundOnly) {
      // The caller proved unchanged authored cells, openings and structural
      // modules. Only generated pavement membership changes; preserve the
      // prepared structural indexes and wall-pick objects.
      const old=this.effectiveCells
      this.effectiveCells = effective ?? withGround(data.cells, data.modules)
      const owned = this.ownedKeys(data.cells)
      const ordered=(all:Cell[]):boolean=>{
        if(all.length<data.cells.length||data.cells.some((c,i)=>all[i]!==c))return false
        for(let i=data.cells.length;i<all.length;i++){
          const c=all[i],p=i>data.cells.length?all[i-1]:null
          if(c.z!==GROUND_Z||c.fill!=='solid'||c.finish||c.tags||owned.has(packKey(c.x,c.y,c.z))||
            p&&!(p.x<c.x||p.x===c.x&&p.y<c.y))return false
        }
        return true
      }
      const incremental=ordered(old)&&ordered(this.effectiveCells)
      let nextGround=this.groundKeys
      const removed:number[]=[],added:Cell[]=[]
      if(incremental){
        let i=data.cells.length,j=data.cells.length
        while(i<old.length||j<this.effectiveCells.length){
          const a=old[i],b=this.effectiveCells[j]
          if(a&&b&&a.x===b.x&&a.y===b.y){i++;j++;continue}
          if(!b||a&&(a.x<b.x||a.x===b.x&&a.y<b.y)){removed.push(packKey(a.x,a.y,a.z));i++}
          else {added.push(b);j++}
        }
      }else{
        nextGround=new Set<number>()
        for(const c of this.effectiveCells){const key=packKey(c.x,c.y,c.z);if(!owned.has(key))nextGround.add(key)}
        for(const key of this.groundKeys)if(!nextGround.has(key))removed.push(key)
        for(const c of this.effectiveCells){const key=packKey(c.x,c.y,c.z);if(nextGround.has(key)&&!this.groundKeys.has(key))added.push(c)}
      }
      const changed=[...removed,...added.map(c=>packKey(c.x,c.y,c.z))]
      const authored=groundWindow(data.cells,[],0)
      this.groundWindowOnly=incremental&&changed.every(key=>{
        const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096
        return x<authored.x0||x>authored.x1||y<authored.y0||y>authored.y1
      })
      if(this.groundWindowOnly){
        for(const key of removed){const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096;this.ctx.groundOf.delete(`${x},${y}`)}
        for(const c of added)this.ctx.groundOf.set(`${c.x},${c.y}`,storeyBand(GROUND_Z,this.ctx.levelBase,this.ctx.storeyHeight))
      }
      for(const key of removed){this.ctx.solid.delete(key);if(incremental){nextGround.delete(key);const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096;this.cellsByChunk.get(chunkColumn(x,y))?.delete(key)}}
      for(const c of added){
        const key=packKey(c.x,c.y,c.z);this.ctx.solid.add(key)
        if(incremental){
          nextGround.add(key)
          const column=chunkColumn(c.x,c.y);let bucket=this.cellsByChunk.get(column)
          if(!bucket)this.cellsByChunk.set(column,bucket=new Map())
          bucket.set(key,[c])
        }
      }
      const columns = new Set<number>()
      for (const key of changed) {
        const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096
        for(const cx of new Set([Math.floor((x-2)/CHUNK)*CHUNK,Math.floor((x+2)/CHUNK)*CHUNK]))
        for(const cy of new Set([Math.floor((y-2)/CHUNK)*CHUNK,Math.floor((y+2)/CHUNK)*CHUNK])){
          const column=chunkColumn(cx,cy)
          columns.add(column);this.chunkOrigins.set(column,[cx,cy])
        }
      }
      if (columns.size <= 256) {
        this.localChunks=columns
        this.localLevels=new Set([storeyBand(GROUND_Z,this.ctx.levelBase,this.ctx.storeyHeight)])
        if(!incremental)this.indexEffectiveCells(columns)
      } else if(!incremental)this.indexEffectiveCells()
      this.groundKeys = nextGround
      this.ctx.stationData = data
      return
    }
    const insets=data.modules.filter(m=>m.type==='platform-edge')
    if(!this.preparedInsets || insets.length!==this.preparedInsets.length || insets.some((m,i)=>m!==this.preparedInsets![i])) {
      this.platformInsets = platformBlockInsets(data.modules)
      this.preparedInsets=insets
    }
    // The street is stored inverted (holes, not blocks), so the mesher works
    // from the **effective** cells: the document's own plus the window's
    // generated ground. The two consumers that walk every cell — this and the
    // walk graph — read the same list, so what is drawn is what is walked.
    this.effectiveCells = effective ?? withGround(data.cells, data.modules)
    if(!structural)this.indexEffectiveCells()
    // Which of them are the **street** and which are the document's: everything
    // `withGround` added. `meshStation` meshes that set on its own pass, so the
    // generated plane is one thing the view can hide (`隐藏地面`) and one thing
    // that is built once.
    this.groundKeys = new Set<number>()
    const owned = this.ownedKeys(data.cells)
    for (const c of this.effectiveCells) {
      const k = packKey(c.x, c.y, c.z)
      if (!owned.has(k)) this.groundKeys.add(k)
    }
    this.ctx.solid = buildSolidSet(this.effectiveCells)
    this.ctx.finishes = finishMapOf(this.effectiveCells)
    this.ctx.stationData = data
    this.ctx.trackCellSet = trackBedKeys(data.cells, data.modules)
    // A stair's turn landing is drawn by the stair model, not the block mesher.
    const solidKeys = this.ctx.solid
    this.ctx.hiddenCells = new Set<number>()
    // Every cell that draws as less than a whole block — a 半墙 the player laid, a
    // 三角 corner, and every block a ramp kept beside its run (`thinWallCells`) — is
    // **meshed**, not hidden: the mesher draws the shape that cell is (`meshBand`), so
    // the drawn panel is what the pointer picks and the face a player paints is the
    // face they clicked. Cut cells are collected here because the mesher's own input
    // is a solid set, which cannot say what shape a cell is.
    this.ctx.thinSides = new Map<number, CellShape>()
    for (const t of thinWallCells(data.cells, data.modules)) this.ctx.thinSides.set(packKey(t.x, t.y, t.z), t.shape)
    // And where a 楼梯 / 扶梯 takes its volume out of a block: the top of a block
    // under a run is the run's underside, so the ground fills up to the truss
    // instead of bulging through it. Derived from the modules alone (a cut is a
    // property of the run, not of the block), so the build ghost's pending cells
    // read their cut from the same map.
    const ramps=data.modules.filter(m=>m.type==='stair'||m.type==='escalator'||m.type==='exit')
    if(!this.preparedRamps || ramps.length!==this.preparedRamps.length || ramps.some((m,i)=>m!==this.preparedRamps![i])) {
      this.ctx.slopeCuts = rampSlopeCuts(data.modules)
      this.preparedRamps=ramps
    }
    // The filling those cuts leave open where the player has laid no block: the
    // wedge between the ground's top and the truss's underside. Drawn from the block
    // below it (`rampFillKeys`), never a cell the document holds.
    this.ctx.slopeFills = rampFillKeys(this.ctx.solid, this.ctx.slopeCuts)
    for (const m of data.modules) {
      if (m.type !== 'stair') continue
      for (const p of stairTurnCells(m)) {
        if (!Number.isInteger(p.z)) continue
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
      for (const z of liftLevels(m)) {
        if (z <= lo) continue
        for (const [fx, fy] of liftFootprintCells(m)) {
          const k = packKey(fx, fy, z)
          if (solidKeys.has(k)) this.ctx.hiddenCells.add(k)
        }
      }
    }
    if (structural) {
      {
        const changed = new Set<number>()
        const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)
        const diffMap = <T,>(before: ReadonlyMap<number,T>, after: ReadonlyMap<number,T>): void => {
          if(before===after)return
          for (const [key,value] of before) if (!same(value,after.get(key))) changed.add(key)
          for (const key of after.keys()) if (!before.has(key)) changed.add(key)
        }
        const diffSet = (before: ReadonlySet<number>, after: ReadonlySet<number>): void => {
          if(before===after)return
          for (const key of before) if (!after.has(key)) changed.add(key)
          for (const key of after) if (!before.has(key)) changed.add(key)
        }
        // The production effective list is authored records followed by plain
        // generated ground. Its membership is compared below, so share the
        // authored-record diff with model retention rather than diffing the
        // whole street twice. Custom effective inputs retain the complete path.
        const ordinaryGround = (all: readonly Cell[], authored: readonly Cell[]): boolean =>
          all.length >= authored.length && authored.every((c,i)=>all[i]===c) &&
          all.slice(authored.length).every(c=>c.fill==='solid'&&c.z===GROUND_Z&&!c.finish&&!c.tags)
        const records = ordinaryGround(structural.cells,previous!.cells) && ordinaryGround(this.effectiveCells,data.cells)
          ? changedCellRecords(previous!.cells,data.cells) : changedCellRecords(structural.cells,this.effectiveCells)
        for(const c of records)changed.add(packKey(c.x,c.y,c.z))
        diffSet(structural.ground,this.groundKeys)
        diffSet(structural.solid,this.ctx.solid)
        diffSet(structural.hidden,this.ctx.hiddenCells)
        diffSet(structural.fills,this.ctx.slopeFills)
        diffMap(structural.finishes,this.ctx.finishes)
        diffMap(structural.thin,this.ctx.thinSides)
        diffMap(structural.cuts,this.ctx.slopeCuts)
        diffMap(structural.insets,this.platformInsets)
        // Rebuild every height in the changed columns. A new lowest floor can
        // change unsupported-plate ownership far above the edit itself.
        const columns = new Set<number>()
        for (const key of changed) {
          const x = Math.floor(key / (8192 * 8192)) - 4096
          const y = Math.floor(key / 8192) % 8192 - 4096
          for (const [dx,dy] of classificationHalo) {
            const cx=Math.floor((x+dx)/CHUNK)*CHUNK,cy=Math.floor((y+dy)/CHUNK)*CHUNK
            columns.add(chunkColumn(cx,cy));this.chunkOrigins.set(chunkColumn(cx,cy),[cx,cy])
          }
        }
        if (columns.size <= 256) {
          this.indexEffectiveCells(columns)
          this.localChunks = columns
          // A carve may remove the final cell in a column; meshStation cannot
          // discover that vanished column while visiting only the new cells.
          for (const key of changed) {
            const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096
            this.ctx.groundOf.delete(`${x},${y}`)
          }
        } else this.indexEffectiveCells()
      }
    }
  }

  private onlyPreparedModulesChanged(before: StationData, after: StationData): boolean {
    const remaining = new Map(before.modules.map(m => [m.id,m]))
    let changed = false
    // Each of these builders' chunk inputs is completely represented by the
    // prepared maps above. Unknown module kinds retain the full hash path.
    const known = (m: typeof after.modules[number]): boolean =>
      ['stair', 'escalator', 'walkway', 'track', 'pillar', 'platform-edge', 'psd-end', 'lift', 'exit', 'door', 'shelf', 'cubicle', 'sink', 'shop'].includes(m.type)
    for (const m of after.modules) {
      const old = remaining.get(m.id)
      remaining.delete(m.id)
      if (old === m || old && JSON.stringify(old) === JSON.stringify(m)) continue
      if (!known(m) || old && !known(old)) return false
      changed = true
    }
    for (const m of remaining.values()) { if (!known(m)) return false; changed = true }
    return changed
  }

  /**
   * Mesh every storey band into chunk meshes (the second half of `setStation`).
   * The orchestrator calls `prepareStation` first, then this, then rebuilds
   * modules, the grid and the level slice — in the order the old method did.
   *
   * Meshes the list `prepareStation` put in `effectiveCells` (document cells plus
   * the generated street window), so the drawn ground is exactly the walked one.
   */
  meshStation(groundOnly = false): void {
    this.retainedLevelMeshes.clear()
    const local=this.localChunks
    if(local)this.localMeshGeneration++
    this.meshedCellVisits=0
    this.groundTemplateHits=0
    const allCells=this.effectiveCells
    if(local){
      // The halo supplies ceiling classification and unsupported-plate votes;
      // only the affected chunks below emit geometry.
      const buckets=new Set<number>()
      for(const key of local){
        // Numeric chunk keys use the same packed coordinate representation.
        const [x,y]=this.chunkOrigins.get(key)!
        for(const [dx,dy]of columnHalo)buckets.add(chunkColumn(x+dx*CHUNK,y+dy*CHUNK))
      }
      this.effectiveCells=[...buckets].flatMap(k=>[...(this.cellsByChunk.get(k)?.values()??[])].flat()).filter(c=>{
        // A two-cell halo spans at most two 16 m chunks per axis. Its four
        // corner chunks cover exactly the same columns as all 25 probes.
        const x0=Math.floor((c.x-2)/CHUNK)*CHUNK,x1=Math.floor((c.x+2)/CHUNK)*CHUNK
        const y0=Math.floor((c.y-2)/CHUNK)*CHUNK,y1=Math.floor((c.y+2)/CHUNK)*CHUNK
        return local.has(chunkColumn(x0,y0))||local.has(chunkColumn(x0,y1))||
          local.has(chunkColumn(x1,y0))||local.has(chunkColumn(x1,y1))
      })
    }
    this.chunkKeyCellVisits = 0
    const previousWindow = this.meshedGroundWindow
    if (!groundOnly) this.groundTopology++
    const nextWindow = this.ctx.stationData ? groundWindow(this.ctx.stationData.cells, this.ctx.stationData.modules) : null
    const computedKeys = new Map<string, string>()
    const groundKeys = new Map<string, string>()
    if (groundOnly) for (const key of this.chunkCache.keys()) {
      const [level, pass, xy] = key.split('|')
      if (pass === 'g') groundKeys.set(`${level}|g|${xy}`, key)
    }
    // **One release per rebuild, and it is the keep-aware one.** What the last
    // rebuild left is given back below, once `keep` is known (`releaseChunks` is
    // called a second time with `keepChunkGeometries` set). Releasing here as well
    // would dispose every cached chunk's geometry and outline material *before* the
    // keep set exists — and because `releaseChunks` also empties `chunkMeshes` and
    // `outlineMeshes`, the guarded call would then have nothing left to skip: every
    // edit re-uploaded the whole station's buffers and recompiled the outline
    // program, which is exactly the cost the cache exists to avoid.
    // The meshes `applyLevel` assigns materials to have just been replaced, so the
    // slice has to be applied again even if the view state itself did not change.
    this.ctx.levelKey = ''
    this.ctx.lastChunkMs = 0
    // Group cells into storeys. A storey is a floor on the fixed 5 m editing
    // grid (`LEVEL_STEPS`) plus the walls it grows up to the next grid line, so
    // a cell belongs to the storey at or below it (`storeyBand`). Keying by the
    // *grid* rather than by a contiguous run matters: a lower floor's 5 m wall
    // reaches the floor above, and the raw run then reads as one tall storey,
    // merging two floors into a single band. Bands may overlap in z across
    // columns, so each band meshes exactly its own cells (`emit`) instead of a
    // z window.
    const bandOfCell = new Map<number, number>()
    // The lowest storey each column reaches. A block standing on that storey has
    // nothing under it, so it is a plate hanging in space: it must stay on screen
    // even when its storey sits above the one being looked at. Anything with a
    // storey below it is that lower room's ceiling and goes with the cut.
    const previousGround=local&&!this.groundWindowOnly?new Map(this.effectiveCells.map(c=>[`${c.x},${c.y}`,this.ctx.groundOf.get(`${c.x},${c.y}`)])):null
    if(!this.groundWindowOnly){
    if(!local)this.ctx.groundOf.clear()
    else for(const c of this.effectiveCells)this.ctx.groundOf.delete(`${c.x},${c.y}`)
    for (const c of this.effectiveCells) {
      if (c.fill !== 'solid') continue
      const band = storeyBand(c.z, this.ctx.levelBase, this.ctx.storeyHeight)
      bandOfCell.set(packKey(c.x, c.y, c.z), band)
      const col = `${c.x},${c.y}`
      const prev = this.ctx.groundOf.get(col)
      if (prev === undefined || band < prev) this.ctx.groundOf.set(col, band)
    }
    }
    if(local&&previousGround)for(const c of this.effectiveCells)if(previousGround.get(`${c.x},${c.y}`)!==this.ctx.groundOf.get(`${c.x},${c.y}`)){
      if(this.localBands){
        // A changed lowest floor widens ownership only around that column.
        // Distant edits on another storey must not form a station-wide product
        // of every affected chunk and every affected level.
        for(const [dx,dy]of classificationHalo){
          const column=chunkColumn(c.x+dx,c.y+dy)
          if(local.has(column))this.localBands.set(column,null)
        }
      }else{
        this.localLevels=null
        break
      }
    }
    // Ceilings have an independently hideable pass. Keep every adjacent ordinary
    // face (including the ledge below one) so hiding that pass never opens a block.
    const suspended = this.groundWindowOnly?this.ceilingKeys:ceilingCells(this.effectiveCells, this.ctx.levelBase, this.ctx.storeyHeight)
    if(!this.groundWindowOnly){
      if(!local)this.ceilingKeys=new Set(suspended)
      else {
        for(const key of this.ceilingKeys){const x=Math.floor(key/(8192*8192))-4096,y=Math.floor(key/8192)%8192-4096;if(local.has(chunkColumn(x,y)))this.ceilingKeys.delete(key)}
        for(const c of this.effectiveCells){const key=packKey(c.x,c.y,c.z);if(local.has(chunkColumn(c.x,c.y))&&suspended.has(key))this.ceilingKeys.add(key)}
      }
    }
    const byBand = new Map<number, { zLo: number; zHi: number; cells: Array<{ x: number; y: number; z: number }> }>()
    // The street's own pass. It is a storey of its own in everything but name: at
    // `GROUND_Z` with the document holding nothing under it, so it is the plate
    // with nothing under it (`float`) that 隐藏天花板 keeps — but it belongs to
    // nobody's band, which is what lets 隐藏地面 take it away whole. The filling a
    // run derives over the street travels with it, so a surface ramp still shaves
    // the pavement it climbs out of.
    const groundCells: Array<{ x: number; y: number; z: number }> = []
    for (const c of this.effectiveCells) {
      if (c.fill !== 'solid') continue
      const k = packKey(c.x, c.y, c.z)
      if(local&&!local.has(chunkColumn(c.x,c.y)))continue
      const levels=this.localBands?this.localBands.get(chunkColumn(c.x,c.y)):this.localLevels
      if(local&&levels&&!levels.has(this.groundWindowOnly?storeyBand(c.z,this.ctx.levelBase,this.ctx.storeyHeight):bandOfCell.get(k)!))continue
      const fill = this.ctx.slopeFills.has(packKey(c.x, c.y, c.z + 1))
      if (this.groundKeys.has(k)) {
        groundCells.push({ x: c.x, y: c.y, z: c.z })
        if (fill) groundCells.push({ x: c.x, y: c.y, z: c.z + 1 })
        continue
      }
      // Equipment can change the virtual street bounds without touching any
      // authored cell, opening or chunk shape. Their cached passes remain exact:
      // the changing window edge is at least GROUND_MARGIN beyond those cells.
      if (groundOnly) continue
      const band = bandOfCell.get(k) as number
      let entry = byBand.get(band)
      if (!entry) {
        entry = { zLo: c.z, zHi: c.z, cells: [] }
        byBand.set(band, entry)
      }
      if (c.z < entry.zLo) entry.zLo = c.z
      if (c.z > entry.zHi) entry.zHi = c.z
      entry.cells.push({ x: c.x, y: c.y, z: c.z })
      // The filling this block carries up to a run's truss is meshed with it, in the
      // block's own storey: it is that block's top surface, not a storey of its own.
      // Listing it here is also what makes it part of the chunk's content hash, so a
      // chunk re-meshes when the ground it grows from changes.
      if (fill) entry.cells.push({ x: c.x, y: c.y, z: c.z + 1 })
    }
    const groundEmit = new Set<number>()
    for (const c of groundCells) groundEmit.add(packKey(c.x, c.y, c.z))
    // Solid set of just those unsupported plates, for meshing them on their own.
    // A block a ramp carve orphaned is skipped: it is the ceiling over that
    // opening (tagged by `carveRampOpenings`), so it belongs to the storey below
    // and is cut with it rather than ghosted above the active level.
    const floating = new Set<number>()
    for (const c of this.effectiveCells) {
      if (groundOnly) break
      if (c.fill !== 'solid') continue
      if (c.tags?.includes(OPENING_CEILING) || suspended.has(packKey(c.x,c.y,c.z))) continue
      if (bandOfCell.get(packKey(c.x, c.y, c.z)) === this.ctx.groundOf.get(`${c.x},${c.y}`)) floating.add(packKey(c.x, c.y, c.z))
    }
    const box = new THREE.Box3()
    // Everything the mesher reads for one chunk, hashed. A chunk whose key is
    // unchanged meshes byte-identically, so its last meshes are reused as they are.
    // `pass` is part of the key because the same cells are meshed on their own when
    // they are unsupported plates — and the street with them — so which pass a
    // chunk belongs to is part of what it draws, and a chunk that changes pass must
    // re-mesh.
    //
    // The mesher culls every face against its immediate neighbour, which often
    // lives in the next chunk: without the 1-cell halo below, deleting a block
    // leaves the neighbouring chunk's key unchanged, so its stale mesh (with the
    // now-exposed face still culled) is reused and the hole never draws until a
    // reload rebuilds every key from scratch.
    const chunkKey = (
      levelZ: number,
      cx: number,
      cy: number,
      pass: ChunkPass,
      cells: Array<{ x: number; y: number; z: number }>,
      emit: ReadonlySet<number>,
      sideSolid: ReadonlySet<number>,
      cover?: ReadonlySet<number>,
    ): string => {
      const address = `${levelZ}|${pass}|${cx},${cy}`
      const computed = computedKeys.get(address)
      if (computed) return computed
      if(local && !groundOnly){
        // The bounded edit already proved exactly which chunks can change.
        // They rebuild below, so hashing their cells/halos cannot retain more
        // geometry. Remote chunks keep their original keys and allocations.
        const result=`${address}|edit:${this.localMeshGeneration}`
        computedKeys.set(address,result)
        return result
      }
      const retainedGround = groundKeys.get(address)
      if (groundOnly && pass === 'g' && previousWindow && nextWindow) {
        // Only the rectangular window changed; authored holes, finishes,
        // ramps and halo votes are fixed for this topology generation.
        const clip = (w: typeof nextWindow) => `${Math.max(cx-1,w.x0)},${Math.min(cx+CHUNK,w.x1)},${Math.max(cy-1,w.y0)},${Math.min(cy+CHUNK,w.y1)}`
        const clipped = clip(nextWindow)
        const result = retainedGround && clip(previousWindow) === clipped ? retainedGround :
          `${address}|ground:${this.groundTopology}:${clipped}`
        computedKeys.set(address, result)
        return result
      }
      this.chunkKeyCellVisits += cells.length
      let h = 2166136261
      let n = 0
      for (const c of cells) {
        const k = packKey(c.x, c.y, c.z)
        if (this.ctx.hiddenCells.has(k)) continue
        h = Math.imul(h ^ c.x, 16777619)
        h = Math.imul(h ^ c.y, 16777619)
        h = Math.imul(h ^ c.z, 16777619)
        // Which shape the cell draws, and which way round: a 半墙 the player re-tags
        // (or a wall that becomes one), or a 三角 turned to another corner, meshes
        // differently at the same coordinates.
        const inset = this.platformInsets.get(k)
        if (inset) for (const value of Object.values(inset)) h = Math.imul(h ^ Math.round(value * 1024), 16777619)
        const shape = this.ctx.thinSides.get(k)
        if (shape !== undefined) h = Math.imul(h ^ shapeKey(shape), 16777619)
        // Where a run cuts the cell's top: placing or deleting a 楼梯 / 扶梯 changes
        // this map without moving a single block, so the cut has to be part of what
        // makes a chunk's mesh, or the ground under the run would keep the old shape.
        const cut = this.ctx.slopeCuts.get(k)
        if (cut !== undefined) {
          // Include every footprint and plane: shape changes need fresh chunks/ghosts.
          for (const char of JSON.stringify([cut.base, cut.patches, cut.finish, cut.noFill, cut.ownBody])) h = Math.imul(h ^ char.charCodeAt(0), 16777619)
          h = Math.imul(h ^ cut.axis.charCodeAt(0), 16777619)
          h = Math.imul(h ^ Math.round(cut.lo * 1024), 16777619)
          h = Math.imul(h ^ Math.round(cut.hi * 1024), 16777619)
          // How wide the run's drawn body is where the cut names a filling: an
          // escalator's truss box is narrower than the cell, and which run owns the cut
          // decides the shape the mesher draws there.
          if (cut.half !== undefined) h = Math.imul(h ^ Math.round(cut.half * 1024), 16777619)
        }
        const fin = this.ctx.finishes.get(k)
        if (fin) {
          // A custom-tinted finish id is a string; hash its characters, not its object.
          for (const id of [fin.top, fin.bottom, fin.e, fin.w, fin.n, fin.s]) {
            if (id === undefined) continue
            for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
            h = Math.imul(h ^ id.length, 16777619)
          }
        }
        // A cap lives or dies by the cover over it, which is no chunk of its own:
        // the storey pass reads it from its own emit (hashed above as cells), but
        // the plate and street passes read cover the chunk does not hold — so a
        // slab laid overhead must change their key, or the old cap is reused.
        if (pass !== 's') {
          const above = packKey(c.x, c.y, c.z + 1)
          const covered = !(pass !== 'c' && suspended.has(above)) &&
            (this.ctx.solid.has(above) || this.ctx.slopeFills.has(above))
          h = Math.imul(h ^ (covered ? 11 : 3), 16777619)
        }
        n++
      }
      // The 1-cell halo: every face the mesher emits depends on the neighbour
      // across it (`sideOpen` sides, `draws`/`standsOn` caps, the ridge-neighbour
      // check and the plate pass's `cover`), with the same votes `meshChunk`
      // reads — the pass's own solid set minus hidden cells and fillings for
      // sides, that set or the filling for caps, the whole-station cover for the
      // plate pass and the pass's emit otherwise, plus the neighbour's shape.
      // Halo coordinates hash in sorted order so the key is stable.
      {
        const halo = new Map<number, { x: number; y: number; z: number }>()
        const addHalo = (x: number, y: number, z: number): void => {
          const hk = packKey(x, y, z)
          if (halo.has(hk)) return
          halo.set(hk, { x, y, z })
        }
        for (const c of cells) {
          // Ambient occlusion reads the cells above and below this course.
          for (const dz of [-1, 1, 2]) addHalo(c.x, c.y, c.z + dz)
          // At a chunk edge, side/corner ambient occlusion also reads diagonals
          // across the boundary. Hash only those external votes; local cells are
          // already covered by this chunk's own input and keep edits bounded.
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (Math.floor((c.x + dx) / CHUNK) * CHUNK === cx &&
                Math.floor((c.y + dy) / CHUNK) * CHUNK === cy) continue
            for (const dz of [-1, 0, 1, 2]) addHalo(c.x + dx, c.y + dy, c.z + dz)
          }
        }
        const sorted = [...halo.values()].sort((a, b) => packKey(a.x, a.y, a.z) - packKey(b.x, b.y, b.z))
        for (const nb of sorted) {
          const hk = packKey(nb.x, nb.y, nb.z)
          h = Math.imul(h ^ nb.x, 16777619)
          h = Math.imul(h ^ nb.y, 16777619)
          h = Math.imul(h ^ nb.z, 16777619)
          const vote =
            sideSolid.has(hk) && !(pass !== 'c' && suspended.has(hk)) && !this.ctx.hiddenCells.has(hk) && !this.ctx.slopeFills.has(hk) ? 1 : 0
          h = Math.imul(h ^ (vote + 2), 16777619)
          const drawsHere = !(pass !== 'c' && suspended.has(hk)) && (sideSolid.has(hk) || this.ctx.slopeFills.has(hk)) ? 1 : 0
          h = Math.imul(h ^ (drawsHere + 5), 16777619)
          if (cover !== undefined) {
            const coveredHere = !(pass !== 'c' && suspended.has(hk)) && (cover.has(hk) || this.ctx.slopeFills.has(hk)) ? 1 : 0
            h = Math.imul(h ^ (coveredHere + 9), 16777619)
          } else {
            h = Math.imul(h ^ (emit.has(hk) && !(pass !== 'c' && suspended.has(hk)) ? 14 : 7), 16777619)
          }
          const inset = this.platformInsets.get(hk)
          if (inset) for (const value of Object.values(inset)) h = Math.imul(h ^ Math.round(value * 1024), 16777619)
          const haloCut = this.ctx.slopeCuts.get(hk)
          if (haloCut) for (const char of JSON.stringify(haloCut)) h = Math.imul(h ^ char.charCodeAt(0), 16777619)
          const haloShape = this.ctx.thinSides.get(hk)
          if (haloShape !== undefined) h = Math.imul(h ^ shapeKey(haloShape), 16777619)
        }
      }
      const result = `${address}|${n}:${h >>> 0}`
      computedKeys.set(address, result)
      return result
    }
    const reuse = new Map(this.chunkCache)
    // Which cached chunks this rebuild will keep, decided **before** anything is
    // released: a reused chunk's `BufferGeometry` must survive the sweep, because a
    // disposed geometry is not re-uploaded and its meshes would draw nothing.
    const keep = new Set<string>()
    const remote=(key:string):boolean=>{
      const [level,pass,xy]=key.split('|'),[x,y]=xy.split(',').map(Number),column=chunkColumn(x,y)
      const levels=this.localBands?this.localBands.get(column):this.localLevels
      return !!local&&(groundOnly&&pass!=='g'||!local.has(column)||!!levels&&!levels.has(Number(level)))
    }
    if(local)for(const key of reuse.keys())if(remote(key))keep.add(key)
    if (groundOnly) for (const [key, entry] of reuse) {
      if (!entry.meshes[0]?.userData.ground) keep.add(key)
    }
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
      // Mirrors the three passes below exactly, so the keys match: the storey's
      // own cells, the unsupported plates among them, and the street's pass.
      // The plate list carries the same truss-filling extras as the meshing
      // call below, or its keys would never match a built chunk.
      for (const [levelZ, band] of byBand) {
        const emit = new Set<number>()
        for (const c of band.cells) emit.add(packKey(c.x, c.y, c.z))
        for (const [k, list] of groupByChunk(band.cells.filter(c => !suspended.has(packKey(c.x,c.y,c.z))))) {
          const [cx, cy] = k.split(',').map(Number)
          const key = chunkKey(levelZ, cx, cy, 's', list, emit, this.ctx.solid)
          if (reuse.has(key)) keep.add(key)
        }
        for (const [k,list] of groupByChunk(band.cells.filter(c => suspended.has(packKey(c.x,c.y,c.z))))) {
          const [cx,cy]=k.split(',').map(Number)
          const key=chunkKey(levelZ,cx,cy,'c',list,emit,this.ctx.solid)
          if(reuse.has(key))keep.add(key)
        }
        const plates = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
        const floats = plates.concat(
          plates
            .filter((c) => this.ctx.slopeFills.has(packKey(c.x, c.y, c.z + 1)))
            .map((c) => ({ x: c.x, y: c.y, z: c.z + 1 })),
        )
        if (floats.length > 0) {
          for (const [k, list] of groupByChunk(floats)) {
            const [cx, cy] = k.split(',').map(Number)
            const key = chunkKey(levelZ, cx, cy, 'f', list, emit, floating, this.ctx.solid)
            if (reuse.has(key)) keep.add(key)
          }
        }
      }
      for (const [k, list] of groupByChunk(groundCells)) {
        const [cx, cy] = k.split(',').map(Number)
        const key = chunkKey(storeyBand(GROUND_Z, this.ctx.levelBase, this.ctx.storeyHeight), cx, cy, 'g', list, groundEmit, this.ctx.solid)
        if (reuse.has(key)) keep.add(key)
      }
    }
    // The one release: everything the last rebuild made that this rebuild is not
    // about to reuse. A kept chunk's geometry and its per-chunk outline material
    // survive it, so re-adding the cached meshes below costs no re-upload and no
    // program recompile.
    if(local && !groundOnly)for(const key of keep)if(!remote(key))keep.delete(key)
    if(groundOnly||local)for(const [key,entry] of reuse)if(keep.has(key))
      for(const mesh of [...entry.meshes,...entry.outlines])this.retainedLevelMeshes.add(mesh)
    this.keepChunkGeometries = keep
    this.releaseChunks(groundOnly || !!local)
    this.ctx.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    this.keepChunkGeometries = null
    const nextCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
    if (groundOnly || local) for (const [key, entry] of reuse) {
      if (local ? !remote(key) : entry.meshes[0]?.userData.ground) continue
      nextCache.set(key, entry)
      for (const mesh of [...entry.meshes, ...entry.outlines]) {
        const levelZ = mesh.userData.levelZ as number
        let group = this.levelGroups.get(levelZ)
        if (!group) {
          group = new THREE.Group(); group.userData.levelZ = levelZ
          this.levelGroups.set(levelZ, group); this.ctx.scene.add(group)
        }
        group.add(mesh)
        if (entry.outlines.includes(mesh)) { this.outlineMeshes.push(mesh); this.outlineSet.add(mesh) }
        else { this.chunkMeshes.push(mesh); if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox) }
      }
    }
    const meshBand = (group: THREE.Group, levelZ: number, cells: Array<{ x: number; y: number; z: number }>, solid: Set<number>, emit: Set<number>, pass: ChunkPass, cover?: ReadonlySet<number>): void => {
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
        if(pass==='g')chunkCells.sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z)
        const key = chunkKey(levelZ, cx, cy, pass, chunkCells, emit, solid, cover)
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
        const build=()=>meshChunk(solid, this.ctx.finishes, cx, cy, levelZ, levelZ, emit, this.ctx.hiddenCells, chunkCells, this.ctx.thinSides, this.ctx.slopeCuts, this.ctx.slopeFills, cover, this.platformInsets, pass === 'c' ? undefined : suspended)
        let chunk:ChunkGeometry
        if(pass==='g'&&nextWindow)chunk=this.plainGround(chunkCells,cx,cy,nextWindow,build)
        else {this.meshedCellVisits+=chunkCells.length;chunk=build()}
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
          mesh.userData.cells = chunkCells.length
          // Tag wall faces so 隐藏墙壁 can fade them (and their outline) alone.
          mesh.userData.wall = finishDef(part.finish).family === 'wall'
          // An unsupported plate — and, on its own pass, the street: a plate is the
          // one thing 隐藏天花板 keeps above the room being edited, and the street is
          // the one plate 隐藏地面 can take away whole.
          mesh.userData.suspendedCeiling = pass === 'c'
          mesh.userData.float = pass === 'f' || pass === 'g'
          mesh.userData.ground = pass === 'g'
          group.add(mesh)
          this.chunkMeshes.push(mesh)
          meshes.push(mesh)
          // Block outlines (inverted hull) removed: they read as a detached face at
          // glancing angles. No outline mesh is emitted per chunk part.
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
      // Local edits have already restored remote chunks into this storey's
      // group. Reuse it so every drawn chunk remains owned by levelGroups;
      // replacing the map entry leaves the old group permanently in the scene.
      let group = this.levelGroups.get(levelZ)
      if (!group) {
        group = new THREE.Group()
        group.userData.levelZ = levelZ
        this.levelGroups.set(levelZ, group)
        this.ctx.scene.add(group)
      }
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
      meshBand(group, levelZ, band.cells.filter(c => !suspended.has(packKey(c.x,c.y,c.z))), this.ctx.solid, emit, 's')
      meshBand(group, levelZ, band.cells.filter(c => suspended.has(packKey(c.x,c.y,c.z))), this.ctx.solid, emit, 'c')
      const plates = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
      if (plates.length > 0) {
        // The ground a plate carries up to a run's truss is meshed with it here too,
        // so the plate draws the same surface in both passes: the second pass holds
        // only the plates as solid, and the filling standing on one would otherwise
        // be left out — and cull the plate's own top face for nothing.
        const floats = plates.concat(
          plates
            .filter((c) => this.ctx.slopeFills.has(packKey(c.x, c.y, c.z + 1)))
            .map((c) => ({ x: c.x, y: c.y, z: c.z + 1 })),
        )
        // `floating` — the whole set, the street included — is what this pass culls
        // against, while only the plates the document owns are meshed here. The
        // street is a plate too, but it has a pass of its own below: drawn by both
        // would be the same surface twice. Caps additionally cull against the whole
        // station (`cover`), so this pass never draws a cap the storey pass culls.
        meshBand(group, levelZ, floats, floating, emit, 'f', this.ctx.solid)
      }
    }
    // The street's pass: the generated window, in the group of the storey it lies
    // in, so the slice rules that already apply to band 0 apply to it — and so
    // 隐藏地面 (`LevelSystem.applyLevel`) can take the whole plane away by hiding
    // these meshes, with no rebuild and no cell of the document touched.
    if (groundCells.length > 0) {
      const groundBand = storeyBand(GROUND_Z, this.ctx.levelBase, this.ctx.storeyHeight)
      let group = this.levelGroups.get(groundBand)
      if (!group) {
        group = new THREE.Group()
        group.userData.levelZ = groundBand
        this.levelGroups.set(groundBand, group)
        this.ctx.scene.add(group)
      }
      meshBand(group, groundBand, groundCells, this.ctx.solid, groundEmit, 'g')
    }
    // releaseChunks already disposed the entries outside keep. Disposing them
    // again here releases the same GPU allocation twice.
    this.chunkCache = nextCache
    this.meshedGroundWindow = nextWindow
    this.effectiveCells=allCells
    this.ctx.bounds = box
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 8))
    // The 剖切 plane is not this system's: `SectionSystem` owns it, and keeping
    // one `THREE.Plane` object alive across a rebuild is what lets the chunk
    // materials go on sharing it by reference. A fresh plane here would leave
    // every material clipped by a surface that no longer moves.
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
    // The shop-wall pick proxies are scene-lifetime singletons sharing one
    // geometry/material: without this a disposed scene keeps them and the group.
    this.wallPick.clear()
    this.ctx.scene.remove(this.wallPick)
    this.wallPickGeo.dispose()
    this.wallPickMat.dispose()
    // `dispose()` is the end of the road, so the cache's own references go too — the
    // geometry itself was already released by `releaseChunks` above.
    this.chunkCache.clear()
    this.cellsByChunk.clear()
    this.chunkOrigins.clear()
    this.localChunks=null
    this.localLevels=null
    this.localBands=null
    this.groundTemplates.clear()
    this.ceilingKeys.clear()
    this.groundWindowOnly=false
    this.retainedLevelMeshes.clear()
    this.effectiveCells=[]
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
  releaseChunks(preserveSliceMaterials = false): void {
    for (const [mesh, detail] of this.details) { mesh.geometry = detail.near; mesh.raycast = detail.raycast }
    this.details.clear()
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
    if (!preserveSliceMaterials) {
      for (const m of this.ctx.dimMats.values()) m.dispose()
      for (const m of this.ctx.clearMats.values()) m.dispose()
      this.ctx.dimMats.clear()
      this.ctx.clearMats.clear()
    }
    this.chunkMeshes = []
    this.outlineMeshes = []
    this.outlineSet = new Set()
  }
}
