// Roof bays and small stair blocks share the block tool's rectangular gesture
// and equipment's placement verdict.
//
// A thin roof tile (and a stair block) fills a rectangle. A truss bay instead
// runs in a straight line along its own crest axis — the bay's local +x, which
// is what the model pitches its sheets around (`render/models/pieces/RoofModel.ts`
// lays the crest along X and every truss/purlin parallel to it). One drag lays
// bay after bay end to end (and a right-drag sweeps the same line back out),
// so a run stays one straight hall rather than a staggered grid.
import { addEquipment, createModule, nextModuleId, removeModule } from '../../build/model.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import { equipmentRefusalNotice } from '../../sim/placement.ts'
import { rotateLocal, trackCells, trackFacing } from '../../sim/track.ts'
import { TRUSS_ROOF_BAY } from '../../sim/structures.ts'
import type { Module } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { rectCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

function pieceAt(modules: readonly Module[], x: number, y: number, z: number, type: string): Module | undefined {
  const stair = type === 'stair-block'
  return modules.find((m) => m.z === z && (stair
    ? m.type === 'stair' && m.cfg.block && m.x === x && m.y === y
    : m.type === 'roof' && trackCells(m).some(([cx, cy]) => cx === x && cy === y)))
}

function bayStep(type: string, rot: number, width: number): [number, number] {
  const mod = createModule(type, 0, 0, 0, 'roof-step', rot, width)
  if (mod?.type !== 'roof') return [1, 1]
  return rot % 2 === 0 ? [mod.w, mod.d] : [mod.d, mod.w]
}

/** True for the two truss bays, which run lines rather than filling rectangles. */
function isTrussRun(type: string): boolean {
  return type === 'roof-shell' || type === 'roof-truss' || type === 'roof-tapered'
}

/** Roof models keep their corner anchor in saves; the pointer carries their centre (§9.5). */
function centredModule(type: string, x: number, y: number, z: number, id: string, rot: number, width: number): Module | null {
  const mod = createModule(type, x, y, z, id, rot, width)
  if (mod?.type !== 'roof') return mod
  const [dx, dy] = rotateLocal(rot, (mod.w - 1) / 2, (mod.d - 1) / 2)
  return { ...mod, x: Math.floor(x - dx), y: Math.floor(y - dy) }
}

/**
 * Bay anchors along the truss's own crest axis through `anchor`, from the
 * anchor out to the pointer's projection on that axis — one anchor per whole
 * 4 m bay (`TRUSS_ROOF_BAY`), in either direction. The lateral coordinate is
 * the anchor's, so a sideways wander never staggers the run.
 */
function trussLineCells(anchor: [number, number, number], target: [number, number, number], rot: number): Array<[number, number, number]> {
  const [fx] = trackFacing(rot)
  const alongX = fx !== 0
  const delta = alongX ? target[0] - anchor[0] : target[1] - anchor[1]
  const n = Math.floor(Math.abs(delta) / TRUSS_ROOF_BAY)
  const sign = delta < 0 ? -1 : 1
  const out: Array<[number, number, number]> = []
  for (let k = 0; k <= n; k++) {
    out.push(alongX ? [anchor[0] + sign * k * TRUSS_ROOF_BAY, anchor[1], anchor[2]] : [anchor[0], anchor[1] + sign * k * TRUSS_ROOF_BAY, anchor[2]])
  }
  return out
}

export class TileEquipmentTool extends ToolController {
  readonly tool = 'module' as const

  onDown(info: PointerInfo): void {
    const hit = info.hit
    if (!hit || !this.ctx.scene()) return
    info.preventDefault()
    const st = useStore.getState()
    const picked = st.station.modules.find((m) => m.id === this.pickModuleAt(info))
    const pickedStair = picked?.type === 'stair' && picked.cfg.block ? picked : undefined
    const pickedRoof = picked?.type === 'roof' ? picked : undefined
    // Roofs are laid against the current level's grid, even when the ray hits
    // an existing roof or another object above that plane. Only stair blocks
    // retain object snapping so a click can target an existing block tile.
    const anchor: [number, number, number] = st.moduleType === 'stair-block'
      ? pickedStair ? [pickedStair.x, pickedStair.y, pickedStair.z] : hit.cell
      : info.button === 2 && pickedRoof ? [pickedRoof.x, pickedRoof.y, pickedRoof.z] : [hit.cell[0], hit.cell[1], st.activeZ]
    const tileType = info.button === 2
      ? pickedStair ? 'stair-block'
        : pickedRoof?.cfg.variant === 'shell' ? 'roof-shell'
          : pickedRoof?.cfg.variant === 'truss' ? 'roof-truss'
            : pickedRoof?.cfg.variant === 'tapered-truss' ? 'roof-tapered' : st.moduleType
      : undefined
    const tileRot = info.button === 2 ? pickedRoof?.rot ?? pickedStair?.rot ?? st.moduleRot : undefined
    const tileWidth = info.button === 2 && pickedRoof
      ? pickedRoof.d
      : undefined
    this.ctx.drag.current = {
      active: true, roof: true, button: info.button, mode: info.button === 2 ? 'remove' : 'add',
      anchor, z: anchor[2], shift: false, sx: info.clientX, sy: info.clientY, downTime: performance.now(),
      ...(tileType ? { tileType, tileRot: tileRot ?? st.moduleRot, tileWidth: tileWidth ?? st.roofWidth } : {}),
    }
    this.draw([anchor])
  }

  onMove(info: PointerInfo): void {
    const hit = info.hit
    if (!hit) return
    const drag = this.ctx.drag.current
    if (drag?.roof) {
      const cells = this.cells(info)
      this.draw(cells)
      const st = useStore.getState()
      if (isTrussRun(st.moduleType)) {
        this.ctx.showMeasure(info.clientX, info.clientY, `${cells.length * TRUSS_ROOF_BAY} m`)
        return
      }
      const xs = cells.map(([x]) => x)
      const ys = cells.map(([, y]) => y)
      const [stepX, stepY] = bayStep(st.moduleType, st.moduleRot, st.roofWidth)
      this.ctx.showMeasure(info.clientX, info.clientY, `${Math.max(...xs) - Math.min(...xs) + stepX} × ${Math.max(...ys) - Math.min(...ys) + stepY} m`)
      return
    }
    const st = useStore.getState()
    const cell: [number, number, number] = st.moduleType === 'stair-block'
      ? hit.cell
      : [hit.cell[0], hit.cell[1], st.activeZ]
    this.ctx.hover.current = { cell, place: hit.place, solid: hit.solid }
    this.draw([cell])
  }

  override refreshHover(): void {
    const drag = this.ctx.drag.current
    if (drag?.roof) this.draw(drag.tileCells ?? [drag.anchor])
    else if (this.ctx.hover.current) this.draw([this.ctx.hover.current.cell])
  }

  private cells(info: PointerInfo): Array<[number, number, number]> {
    const drag = this.ctx.drag.current!
    const rect = performance.now() - drag.downTime >= LONG_PRESS_MS && isMoved(drag, info)
    if (!rect) return [drag.anchor]
    const st = useStore.getState()
    const type = drag.tileType ?? st.moduleType
    const rot = drag.tileRot ?? st.moduleRot
    const width = drag.tileWidth ?? st.roofWidth
    if (isTrussRun(type)) {
      return trussLineCells(drag.anchor, info.hit?.cell ?? drag.anchor, rot)
    }
    const all = rectCells(drag.anchor, info.hit?.cell ?? drag.anchor, drag.z, false)
    const [stepX, stepY] = bayStep(type, rot, width)
    // One anchor per whole bay, even after R swaps its world-space axes.
    return all.filter(([x, y]) => Math.abs(x - drag.anchor[0]) % stepX === 0 && Math.abs(y - drag.anchor[1]) % stepY === 0)
  }

  private draw(cells: Array<[number, number, number]>): void {
    if (this.ctx.drag.current?.roof) this.ctx.drag.current.tileCells = cells
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    const removing = this.ctx.drag.current?.mode === 'remove'
    const type = this.ctx.drag.current?.tileType ?? st.moduleType
    const rot = this.ctx.drag.current?.tileRot ?? st.moduleRot
    const width = this.ctx.drag.current?.tileWidth ?? st.roofWidth
    const mods: Module[] = []
    for (const [x, y, z] of cells) {
      if (removing) {
        const roof = pieceAt(st.station.modules, x, y, z, type)
        if (roof) mods.push(roof)
        continue
      }
      const mod = centredModule(type, x, y, z, `roof-preview-${x}-${y}`, rot, type === 'stair-block' ? st.stairBlockHeight : width)
      if (!mod) continue
      const roof = pieceAt(st.station.modules, mod.x, mod.y, z, type)
      if (roof?.x === mod.x && roof.y === mod.y) continue
      mods.push(mod)
    }
    const check = checkModulePlacements(st.station, mods.map((module) => ({ id: module.id, module, layer: true })))
    scene.setGhost([], 'add')
    scene.setModulePreview(mods.length ? mods : null, removing || check.refused.size > 0)
    scene.setCollisionHighlight(removing ? null : check.colliderIds)
    scene.setCursor(null)
  }

  onUp(info: PointerInfo): void {
    const drag = this.ctx.drag.current
    if (!drag?.roof) return
    const cells = this.cells(info)
    this.ctx.drag.current = null
    this.ctx.clearMeasure()
    const scene = this.ctx.scene()
    scene?.setModulePreview(null)
    scene?.setCollisionHighlight(null)
    scene?.setCursor(null)
    const st = useStore.getState()
    let next = st.station
    let why = ''
    const type = drag.tileType ?? st.moduleType
    const rot = drag.tileRot ?? st.moduleRot
    const width = drag.tileWidth ?? st.roofWidth
    for (const [x, y, z] of cells) {
      if (drag.mode === 'remove') {
        const roof = pieceAt(next.modules, x, y, z, type)
        if (roof) next = removeModule(next, roof.id)
        continue
      }
      const mod = centredModule(type, x, y, z, nextModuleId(next.modules, type === 'stair-block' ? 'stair' : 'roof'), rot, type === 'stair-block' ? st.stairBlockHeight : width)
      if (!mod) continue
      const roof = pieceAt(next.modules, mod.x, mod.y, z, type)
      if (roof?.x === mod.x && roof.y === mod.y) continue
      const check = checkModulePlacements(next, [{ id: mod.id, module: mod, layer: true }])
      if (check.refused.size) {
        why ||= equipmentRefusalNotice(check.refused.values().next().value as Parameters<typeof equipmentRefusalNotice>[0])
        continue
      }
      next = addEquipment(next, mod)
    }
    if (next !== st.station) st.commit(next)
    if (why) st.setNotice(why)
  }
}
