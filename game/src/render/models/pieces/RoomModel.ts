// Walled facility room builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, finishSlab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { facilityWallCells, SHOP_WALL_H } from '../../../build/model.ts'
import { HALF_WALL_T } from '../../../sim/constants.ts'
import { DOOR_SPECS } from '../../../sim/doors.ts'
import { finishOf } from '../../../sim/finishes.ts'
import { buildDoor, doorMaterials } from './DoorModel.ts'
import type { Cell, Face, Module } from '../../../sim/types.ts'

/* --------------------------------------- walled rooms and the booth */

/**
 * Walled facility room (商店 / 厕所 / 办公室): its solid perimeter walls are
 * drawn here as thin 0.5 m panels — the chunk mesher hides the full wall voxels
 * (see `hiddenCells`), so the inner half of every wall cell is free for
 * furniture. The fit-out (`cfg.kind`) fills the zone; the wall, doorway and
 * opening logic is shared. A room wears **no name plate**: which fit-out stands
 * inside is the room's own business, and the plate it used to hang over the
 * doorway only ever repeated 商店 / 厕所 / 办公室 over the shelves and cubicles
 * that already say so. World space, origin at the floor.
 */
function buildRoom(ctx: ModuleContext, mod: Extract<Module, { type: 'shop' }>): THREE.Group {
  const g = new THREE.Group()
  const mats = ctx.mats
  const kind = mod.cfg.kind ?? 'store'
  const z0 = mod.z + 1
  const x0 = mod.x
  const x1 = mod.x + mod.w - 1
  const y0 = mod.y
  const y1 = mod.y + mod.h - 1
  /** Half a block: the wall leaves room for a shelf against it. */
  const WALL_T = HALF_WALL_T

  // NO fit-out draws its furniture here: shelves, desks, cubicles and sinks are
  // modules of their own (stocked by `placeFacility`, migrated by
  // `ensureRoomFurniture`), so each unit is individually right-clickable.

  // Thin walls, wearing the finish painted on each cell's inward face. A side
  // the shop did not wall itself — because an existing full wall block already
  // encloses it — still gets a half-width panel, so the room reads the same
  // all the way round.
  const cellAt = new Map<string, Cell>()
  const solid = new Set<string>()
  for (const c of ctx.data.cells) {
    cellAt.set(`${c.x},${c.y},${c.z}`, c)
    if (c.fill === 'solid') solid.add(`${c.x},${c.y},${c.z}`)
  }
  const wallMat = (key: string, face: Face): THREE.Material => ctx.finish(finishOf(cellAt.get(key) ?? {}, face))
  const encloses = (x: number, y: number): boolean => solid.has(`${x},${y},${mod.z}`) && solid.has(`${x},${y},${mod.z + 1}`)

  // Group the wall by column, so a full-height run is one panel rather than a
  // stack of unit boxes whose coincident faces fight at every joint.
  interface WallCol {
    x: number
    y: number
    zLo: number
    zHi: number
    key: string
  }
  const columns = new Map<string, WallCol>()
  const addCol = (x: number, y: number, zLo: number, zHi: number): void => {
    const col = `${x},${y}`
    const e = columns.get(col)
    if (e) {
      if (zLo < e.zLo) e.zLo = zLo
      if (zHi > e.zHi) e.zHi = zHi
    } else columns.set(col, { x, y, zLo, zHi, key: `${x},${y},${zLo}` })
  }
  for (const [x, y, z] of facilityWallCells(ctx.data.cells, mod)) addCol(x, y, z, z)
  const doorHere = new Set((mod.cfg.door ?? []).map(([x, y]) => `${x},${y}`))
  const sideCol = (x: number, y: number): void => {
    if (columns.has(`${x},${y}`) || doorHere.has(`${x},${y}`)) return
    const ox = x === x0 ? x - 1 : x === x1 ? x + 1 : x
    const oy = y === y0 ? y - 1 : y === y1 ? y + 1 : y
    if (encloses(ox, oy)) addCol(x, y, mod.z + 1, mod.z + SHOP_WALL_H)
  }
  for (let x = x0; x <= x1; x++) {
    sideCol(x, y0)
    sideCol(x, y1)
  }
  for (let y = y0; y <= y1; y++) {
    sideCol(x0, y)
    sideCol(x1, y)
  }

  for (const { x, y, zLo, zHi, key } of columns.values()) {
    const h = zHi - zLo + 1
    const cz = (zLo + zHi + 1) / 2
    // Where the room's own west/east run meets its own south/north run, the two
    // panels must not both want the same cell — two 0.5 m walls stacked into one
    // square metre would be a lump of extra thickness at every corner. So the
    // west/east run takes the corner cell **whole**: its 1 m depth reaches the far
    // outer face, which is what closes the other run's end. The south/north run
    // stops one thickness short of it and butts against the west/east panel's inner
    // face, meeting it on the plane between them. The result is a plain 90° corner
    // at both the room's own corner and the one its two inner faces make, one panel
    // thick on every side, with the corner cell's inner half still free for
    // furniture. (A `mitreCap` triangular prism used to fill that cell on its
    // diagonal; its apex reached the cell's *inner* corner, so it also laid a 0.5 m
    // wedge across the free half. There is nothing left for it to fill.)
    const cornerX = x === x0 || x === x1
    if (y === y0 || y === y1) {
      // A south/north panel crosses the room's whole width, giving the corner
      // square to the west/east run at each end it owns (`cornerX` is this column's
      // own side of the room, not merely a column on the perimeter).
      const a = x === x0 && cornerX ? x0 + WALL_T : x
      const b = x === x1 && cornerX ? x1 + 1 - WALL_T : x + 1
      const cy = y === y0 ? y + WALL_T / 2 : y + 1 - WALL_T / 2
      // The panel's inside face is the one the room sees and the player clicks:
      // south/north walls show their n/s face, west/east walls their e/w face.
      if (b > a) finishSlab(g, wallMat(key, y === y0 ? 'n' : 's'), (a + b) / 2, cy, cz, b - a, WALL_T, h).userData.wall = true
    }
    if (cornerX) {
      // One square-ended panel per west/east run column, the corner cell included:
      // no diagonal, so the two runs cannot leave a seam to mitre.
      const cxx = x === x0 ? x + WALL_T / 2 : x + 1 - WALL_T / 2
      finishSlab(g, wallMat(key, x === x0 ? 'e' : 'w'), cxx, y + 0.5, cz, WALL_T, 1, h).userData.wall = true
    }
  }

  const door = mod.cfg.door ?? []
  const wallSide = (x: number, y: number): 's' | 'n' | 'w' | 'e' | null =>
    x === x0 ? 'w' : x === x1 ? 'e' : y === y0 ? 's' : y === y1 ? 'n' : null

  // 厕所 / 办公室 close their openings with a real door — the same free-standing doorway
  // the 装饰 门 piece builds, set into the hole they cut. A 商店 keeps its open shop
  // front, so this is skipped for `store`.
  //
  // The door is **the 门 piece's own builder** (`DoorModel.ts` `buildDoor`), not a second
  // drawing of one: the same threshold, posts, head, leaves and fittings, at the
  // opening's own width. What the doorway adds is where the piece stands — centred on the
  // opening, on the floor, facing into the room — so every measurement below is the
  // doorway's own and every member is the piece's.
  if (kind !== 'store' && door.length > 0) {
    /** A doorway's own height: the 装饰 door's, so the two pieces read as one. */
    const DOOR_H = DOOR_SPECS['steel-1'].h
    /** The door's leaf finish here — the room's own door is the stainless piece. */
    const doorMats = doorMaterials(mats, 'steel')
    const addDoor = (s: 's' | 'n' | 'w' | 'e', dLo: number, dHi: number): void => {
      const alongX = s === 's' || s === 'n'
      const start = dLo
      const end = dHi + 1
      const width = end - start
      // The opening's centre in the caller's own x/y terms, its floor, and the way **into
      // the room**. The piece faces that way — `buildDoor` moulds it with its local +y
      // across the doorway and its run along local x — so the rotation is the quarter-turn
      // whose own outward step is that direction, and the piece is set on the wall's own
      // plane at the middle of the opening.
      const into: [number, number] = s === 's' ? [0, 1] : s === 'n' ? [0, -1] : s === 'w' ? [1, 0] : [-1, 0]
      // The quarter-turn whose own outward step **is** `into` (`rotateLocal(rot, 0, 1)`):
      // the piece's local +y is the way it faces, so this is what makes it look into the
      // room rather than out of it. A quarter turn anticlockwise takes +y to −x, so the
      // two x-sides are the *opposite* way round from the two y-sides.
      const rot = into[0] === 1 ? 3 : into[0] === -1 ? 1 : into[1] === 1 ? 0 : 2
      const face = s === 'w' ? x0 : s === 'e' ? x1 + 1 : s === 's' ? y0 : y1 + 1
      const at: [number, number, number] = alongX ? [(start + end) / 2, face, z0] : [face, (start + end) / 2, z0]
      // One leaf for a one-cell opening, a pair once two would read better than one —
      // the same threshold the shared builder's own leaf widths assume.
      //
      // The doorway is built into a **group of its own**, placed and turned like the
      // standing 门's (`buildStandingDoor`): `buildDoor` sizes every member in the piece's
      // own frame, so a doorway measured in world axes would swap its run and its depth on
      // the two x-sides and draw the leaves and head straight through the wall.
      const doorway = new THREE.Group()
      doorway.name = 'doorway'
      doorway.position.set(at[0], at[1], at[2])
      doorway.rotation.z = (rot * Math.PI) / 2
      g.add(doorway)
      buildDoor(doorway, (x, z, y) => [x, y, z], doorMats, { span: width, panelH: DOOR_H, leaves: width > 1.9 ? 2 : 1 })
    }
    // Group the opening cells by wall and door each contiguous run separately.
    const bySide = new Map<'s' | 'n' | 'w' | 'e', Set<number>>()
    for (const [x, y] of door) {
      const s = wallSide(x, y)
      if (!s) continue
      const set = bySide.get(s) ?? new Set<number>()
      set.add(s === 's' || s === 'n' ? x : y)
      bySide.set(s, set)
    }
    for (const [s, set] of bySide) {
      const coords = [...set].sort((a, b) => a - b)
      let runLo = coords[0]
      let prev = coords[0]
      for (let i = 1; i < coords.length; i++) {
        if (coords[i] === prev + 1) {
          prev = coords[i]
          continue
        }
        addDoor(s, runLo, prev)
        runLo = coords[i]
        prev = coords[i]
      }
      addDoor(s, runLo, prev)
    }
  }

  return g
}

export class RoomModel extends PieceBuilder {
  readonly kind = 'shop'
  build(mod: Extract<Module, { type: 'shop' }>): THREE.Group {
    return buildRoom(this.ctx, mod)
  }
}

