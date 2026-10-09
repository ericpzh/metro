import { escalatorIsLong } from '../../sim/escalators.ts'
// The 吸取 (picker) tool (工具栏, `P`): click anything built and take it into
// the brush — the generalised form of the old 材质 folder's 取色 (`I`), which
// only lifted a face finish. Clicking a placed piece of equipment / 装饰 arms
// the 设备/装饰 placement with that exact variant (and its rotation, escalator
// direction or 闸机 door), selects the clicked instance, and hands the left
// rail to the folder that owns it — via the normal `setTool('module')`, so the
// rail's auto-open effect (`LeftRail`) reveals the piece's own tile the same
// way as picking it by hand, and scrolls it into view (`armedRailTile`).
// Clicking a **指示牌** copies the piece's own printed boards into the current
// pair (`adoptSignBoards`), so the sign a click hangs is the sign that was
// picked. Clicking a bare block face instead lifts its finish into the 材质
// brush (`selectPaintFinish`, which switches to the paint tool in its `N`/`M`
// mode). A rail bed hands to the 轨道 tool, a walled room to the 分区 tool's room
// brush; a derived 站台门 is only selected, since no tool places one directly.
//
// **What a pick changed is remembered** (`beginPick`), so **Esc** puts the whole
// gesture back — tool, piece and settings alike (`cancelPick`, wired through the
// viewport's own Escape). A pick is not an edit: nothing in the document moves,
// and there is nothing for the undo stack to hold.
//
// A stair is picked as equipment (its variant), not as a finish: its treads
// belong to the piece, so there is no bare face to lift there. The old stair-
// finish eyedropper moved with it — painting a stair still works from 材质.

import { cellKey, faceFinish, facePresent } from '../../build/model.ts'
import { railModuleAt } from '../../build/rail.ts'
import { finishLabel } from '../../sim/finishes.ts'
import { isCeilingHung, isWallMounted, moduleAt } from '../../sim/placement.ts'
import { signBoardsOf, signMountSpec } from '../../sim/sign.ts'
import type { Module } from '../../sim/types.ts'
import { MODULE_OPTIONS, moduleLabel, useStore } from '../store.ts'
import { dominantFace } from './geometry/faces.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

const OPTION_IDS = new Set(MODULE_OPTIONS.map((m) => m.id))

/**
 * The palette option id a placed module was built from, or null when no tool
 * places the type directly (track, rooms, the derived platform edge). Variant
 * families spell the variant in the palette id (`bench-steel-1`, …) while the
 * module carries the bare type plus its `cfg`, so each family is mapped back
 * explicitly — and validated against `MODULE_OPTIONS`, so an old save's
 * variant can never arm the tool with a tile the rail does not draw.
 */
function paletteIdForModule(mod: Module): string | null {
  let id: string | null = null
  switch (mod.type) {
    case 'light':
      id = `light-${mod.cfg.variant}`
      break
    case 'pillar':
      id = `pillar-${mod.cfg.size}`
      break
    case 'roof':
      id = mod.cfg.variant === 'tapered-truss'
        ? 'roof-tapered'
        : mod.cfg.variant === 'shell'
          ? 'roof-shell'
          : mod.cfg.variant === 'truss'
            ? 'roof-truss'
            : 'roof'
      break
    case 'bench':
      id = `bench-${mod.cfg.variant ?? 'steel-1'}`
      break
    case 'busstop':
      id = `busstop-${mod.cfg.variant}`
      break
    case 'billboard':
      id = `billboard-${mod.cfg.variant ?? 'wide'}`
      break
    case 'glass':
      id = `glass-${mod.cfg.variant ?? '1x1'}`
      break
    case 'door':
      id = `door-${mod.cfg.variant ?? 'steel-1'}`
      break
    case 'calligraphy':
      id = `calligraphy-${mod.cfg.style ?? 'kai'}-${mod.cfg.axis ?? 'h'}`
      break
    case 'linemap':
      id = mod.cfg.mount === 'stand' ? 'linemap-stand' : 'linemap-wall'
      break
    case 'sign':
      // The two mounts are two tiles, so a picked sign arms the one it was hung as —
      // the wall board and the overhead board are different pieces off the same
      // palette row (`sim/sign.ts`).
      id = signMountSpec(mod.cfg.mount).hung ? 'sign-ceiling' : 'sign-wall'
      break
    case 'stair':
      id = mod.cfg.block ? 'stair-block' : `stair-${mod.cfg.style ?? 'straight'}`
      break
    case 'exit': {
      const covered = mod.cfg.covered ?? true
      const bays = mod.cfg.bays === 1 || mod.cfg.bays === 3 ? mod.cfg.bays : 2
      if (mod.cfg.style === 'doorway') { id = `exit-doorway-${bays}`; break }
      id = covered
        ? bays === 1
          ? 'exit-covered-1'
          : bays === 3
            ? 'exit-covered-3'
            : 'exit'
        : bays === 1
          ? 'exit-uncovered-1'
          : bays === 3
            ? 'exit-uncovered-3'
            : 'exit-uncovered-2'
      break
    }
    case 'gate':
    case 'fence':
    case 'guidepost':
    case 'tvm':
    case 'vending':
    case 'shelf':
    case 'desk':
    case 'cubicle':
    case 'sink':
    case 'bin':
    case 'extinguisher':
    case 'vent':
    case 'clock':
    case 'cctv':
    case 'tv':
    case 'escalator':
    case 'lift':
      id = mod.type
      break
    default:
      id = null
      break
  }
  if (id !== null && !OPTION_IDS.has(id)) id = OPTION_IDS.has(mod.type) ? mod.type : null
  return id
}

export class PickTool extends ToolController {
  readonly tool = 'pick' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    if (!scene) return
    // The picker never deletes: a right press is simply not a pick.
    if (info.button === 2) return
    const hit = info.hit
    if (!hit) return
    const st = useStore.getState()
    // The drawn mesh wins, exactly as in 选择: a large head-house is drawn far
    // past its collision box, and a rail's bed is dug, so the track module is
    // looked for at both the hit and the cell above.
    const rail =
      railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
      railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
    const pickedId = this.pickModuleAt(info)
    const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
    const mod = picked ?? rail ?? (hit.solid ? moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined)
    if (mod) {
      const label = moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined)
      // A derived screen door has no placement of its own: select it, stay.
      if (mod.type === 'platform-edge') {
        st.select({ kind: 'module', key: mod.id, label })
        return
      }
      // **Every branch below re-arms the rail**, so the state it stands on is noted
      // first: Esc puts the picked piece back and the player is where they were
      // (`cancelPick`). The screen door above changes nothing and so notes nothing.
      st.beginPick()
      // A rail run belongs to the 轨道 tool: selecting it reveals the 轨道
      // folder (`findSelectedTrack`), which is the rail's half of the link.
      if (mod.type === 'track' && mod.cfg.bridge) {
        st.setModuleType('bridge')
        st.setStructureOptions({ bridgeLength: mod.w, bridgeRailing: mod.cfg.bridgeRailing ?? 'railing' })
        st.setTool('module')
        return
      }
      if (mod.type === 'track') {
        st.setTool('rail')
        st.select({ kind: 'module', key: mod.id, label })
        st.setNotice(`已吸取${label}`)
        return
      }
      // A walled room belongs to the 分区 tool's room brush: arming that brush
      // reveals the 房间 folder, the room's own tile.
      if (mod.type === 'shop' || mod.type === 'booth' || mod.type === 'retail') {
        const kind = mod.type === 'booth' ? 'ticket' : (mod.cfg.kind ?? 'store')
        st.setZoneBrush(kind === 'toilet' || kind === 'office' || kind === 'ticket' ? kind : 'store')
        st.setTool('zone')
        st.select({ kind: 'module', key: mod.id, label })
        st.setNotice(`已吸取${label}`)
        return
      }
      const optionId = paletteIdForModule(mod)
      if (optionId === null) {
        st.select({ kind: 'module', key: mod.id, label })
        return
      }
      // Arm the placement with the picked piece's own settings, so the next
      // click lands the same variant stood the same way. A wide stair's lane
      // count is deliberately not copied: one lane carries no record of how
      // many it was laid with, so the width stays where the player left it.
      //
      // A 指示牌 is **its boards** (§5.8): the piece's tile alone would hang
      // whatever board was composed last, so the picked sign's own two printed
      // faces become the current pair — the ghost under the pointer and the sign
      // the next click hangs are the one the player pointed at.
      if (mod.type === 'sign') st.adoptSignBoards(signBoardsOf(mod.cfg, st.station))
      st.setModuleType(optionId)
      if (mod.type === 'guidepost') st.setGuideExitId(mod.cfg.exitId ?? null)
      if (mod.type === 'light') st.setLightPosition(mod.cfg.position ?? 0)
      if (mod.type === 'pillar') useStore.setState({ pillarLength: mod.cfg.height === 2 ? 2 : 4 })
      if (mod.type === 'stair' && mod.cfg.block) st.setStairBlockHeight(mod.cfg.blockHeight ?? 1)
      if (typeof mod.rot === 'number') st.setModuleRot(mod.rot)
      if (mod.type === 'escalator') {
        st.setEscalatorDir(mod.cfg.dir)
        if (st.escalatorWide !== (mod.cfg.width === 2)) st.toggleEscalatorWidth()
        if (st.escalatorLong !== escalatorIsLong(mod)) st.toggleEscalatorLength()
      }
      if (mod.type === 'roof' && mod.cfg.variant) st.setRoofWidth(mod.d)
      if (mod.type === 'lift') st.setLiftStyle(mod.cfg.style === 'steel' ? 'steel' : 'glass')
      if (mod.type === 'gate') st.setGateDoor(mod.cfg.door ?? 'lane')
      st.setTool('module')
      st.select({ kind: 'module', key: mod.id, label })
      st.setNotice(`已吸取${label}`)
      return
    }
    // No piece under the pointer: a solid face lends its finish to the 材质
    // brush instead, exactly as the old 取色 did. The surface is resolved the way
    // the brush itself resolves it (`facePresent`): a **半墙**'s panel is half a
    // block thick, so the face looking across its own cell's clear half is a
    // surface *inside* the cell, and a **三角**'s slope is a face of the piece
    // drawn whether or not the cell it leans to is solid. Both are picked on that
    // surface — never on the whole block, and never on a face that is not drawn.
    if (hit.solid) {
      const face = dominantFace(hit.normal)
      const [x, y, z] = hit.cell
      if (!facePresent(this.ctx.solids(), this.ctx.thins(), x, y, z, face)) return
      const finish = faceFinish(st.station.cells, x, y, z, face)
      // A face is a pick like any other — it hands the tool and the brush over —
      // so it notes the state it stands on for Esc as well.
      st.beginPick()
      st.selectPaintFinish(finish)
      st.select({ kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
      st.setNotice(`已吸取${finishLabel(finish)}`)
    }
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    // Hover is just the highlight: the drawn model ghosts itself (a wall panel
    // or hung fitting rings no floor cell), otherwise the floor cell is ringed.
    const pickedId = this.pickModuleAt(info)
    const picked = pickedId ? useStore.getState().station.modules.find((m) => m.id === pickedId) : undefined
    if (picked && (isWallMounted(picked) || isCeilingHung(picked))) {
      scene.setCursor(null)
      scene.setModulePreview(picked, false)
      return
    }
    if (picked) {
      scene.setModulePreview(picked, false)
      scene.setCursor(hit.cell, true)
      return
    }
    scene.setModulePreview(null)
    scene.setCursor(hit.solid ? hit.place : hit.cell, true)
  }

  // The pick commits on press; the release owns nothing.
  onUp(_info: PointerInfo): void {}
}
