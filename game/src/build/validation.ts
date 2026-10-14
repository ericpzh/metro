import { msg } from '../sim/i18n.ts'
// One question, one answer: may this go here, and what is in the way?
//
// The builder asks it twice for every piece — the **preview** under the pointer
// and the **commit** on release — and those two used to answer it separately:
// `app/tools/*` ran the rules inline to colour the ghost, and `build/model/*`
// ran its own copy to decide the edit. Two copies of one rule drift, and the
// drift is exactly what the player sees as a surprise: a preview that silently
// drops a cell, or a ghost that promises one the release refuses.
//
// The rules themselves live one layer down, in `sim/placement.ts` — `blockReason`
// for a block, `equipmentReason` for a module — because they are statements about
// the station model, not about drawing it. This module is the **gathering** layer
// over them: it runs a whole preview's worth of candidates through that one
// verdict and hands the result to the ghost and the collision highlight, so the
// red cells, the red boxes round the offending pieces and the refusal the release
// reports can never disagree.
//
// Consumers: `app/tools/{BlockTool,EquipmentTool,WallTool}.ts` on the preview side,
// `build/model/{Cells,Floors,Walls}.ts` on the release side, and
// `sim/placement.ts`'s own `moveDropReason` for a lifted piece — all reading the
// same two functions.
//
// Pure data — no three, no DOM, no store.

import { blockReason, blockerLabels, equipmentReason, equipmentRefusalNotice, placementColliders } from '../sim/placement.ts'
import type { BlockRefusal, EquipmentRefusal } from '../sim/placement.ts'
import { blockIndex } from '../sim/blockIndex.ts'
import type { BlockIndex } from '../sim/blockIndex.ts'
import type { Cell, Module } from '../sim/types.ts'

export type { BlockRefusal, EquipmentRefusal }
export { blockReason, blockerLabels, equipmentReason, equipmentRefusalNotice } from '../sim/placement.ts'

/** The part of a station a placement decision reads. */
export interface PlacementDoc {
  cells: readonly Cell[]
  modules: readonly Module[]
}

/**
 * The whole preview one pointer move produces. `accepted` and `refused` together
 * are every candidate, so a caller never has to re-derive which is which.
 */
export interface PlacementPreview {
  /** Ids (or cell keys) the release will take, in candidate order. */
  accepted: string[]
  /** The cells the accepted candidates stand in — the cyan ghost's geometry. */
  acceptedCells: Array<[number, number, number]>
  /** Every candidate's cell, for a caller that needs the whole footprint. */
  cells: Array<[number, number, number]>
  /** Candidate id → why it is refused. */
  refused: Map<string, string>
  /** The refused cells, for the red boxes. */
  blockedCells: Array<[number, number, number]>
  /** Placed modules to box in red — the pieces standing in the way. */
  colliderIds: string[]
}

/** A fresh preview under construction; `addPreview` folds each verdict into it. */
export function newPreview(): PlacementPreview {
  return { accepted: [], acceptedCells: [], cells: [], refused: new Map(), blockedCells: [], colliderIds: [] }
}

/** Fold one verdict into a preview: the accepted id, or the refusal and its fits. */
function addPreview(out: PlacementPreview, id: string, ok: boolean, reason: string, cell: [number, number, number], blockers: readonly Module[]): void {
  out.cells.push(cell)
  if (ok) {
    out.accepted.push(id)
    out.acceptedCells.push(cell)
    return
  }
  out.refused.set(id, reason)
  out.blockedCells.push(cell)
  for (const b of blockers) if (!out.colliderIds.includes(b.id)) out.colliderIds.push(b.id)
}

/**
 * The block tool's preview: every candidate cell of a click, a cut piece or a
 * rectangle drag, split into the cells the release will take and the cells it
 * refuses — with the pieces standing in the way pulled out for the red boxes. The
 * release asks the same `blockReason` (`addCells` / `addFloor` / `addWalls`), so the
 * cells this reddens are the cells the release really drops.
 *
 * A cell the station already holds is **not a candidate** and so is not a refusal
 * either: a drag over its own floor has nothing to complain about. That is also the
 * line the release draws (`addCells` skips what is already solid), which is what
 * makes the two lists comparable.
 *
 * The per-level occupancy cache is built once for the whole rectangle rather than
 * once per cell — a drag over a station with two hundred pieces asks the same
 * question a hundred times.
 */
const lastBlockPreview = new WeakMap<BlockIndex, { key: string; preview: PlacementPreview }>()

export function checkBlockCells(station: PlacementDoc, cells: Array<[number, number, number]>): PlacementPreview {
  const occupied = blockIndex(station.cells, station.modules)
  const key = cells.map(c => c.join(',')).join('|')
  const cached = lastBlockPreview.get(occupied)
  if (cached?.key === key) return cached.preview
  const out = newPreview()
  const seen = new Set<string>()
  const held = occupied.solid
  for (const [x, y, z] of cells) {
    const k = `${x},${y},${z}`
    if (seen.has(k)) continue
    seen.add(k)
    // The street is already floor: like any held cell it is neither accepted
    // nor refused, so a drag across virgin ground draws no red boxes.
    if (held.has(k) || occupied.ground(x, y, z)) continue
    const check = blockReason(station.cells, station.modules, x, y, z, occupied)
    addPreview(out, k, check.ok, check.reason, [x, y, z], check.blockers)
  }
  lastBlockPreview.set(occupied, { key, preview: out })
  return out
}

/**
 * The equipment preview: one verdict per candidate module — a wide 楼梯's lanes are
 * several candidates, one placement — with the pieces a refusal collides with
 * collected for the red boxes.
 */
export function checkModulePlacements(
  station: PlacementDoc,
  candidates: ReadonlyArray<{ id: string; module: Module; layer?: boolean }>,
): PlacementPreview {
  const out = newPreview()
  for (const { id, module, layer } of candidates) {
    const reason = equipmentReason(station.cells, station.modules, module, layer)
    const blockers = reason === '' ? [] : placementColliders(station.modules, module)
    addPreview(out, id, reason === '', reason, [module.x, module.y, module.z], blockers)
  }
  return out
}

/** The first refusal in a preview, for a notice line. */
export function firstRefusal(preview: PlacementPreview): EquipmentRefusal | BlockRefusal | '' {
  for (const reason of preview.refused.values()) return reason as EquipmentRefusal | BlockRefusal
  return ''
}

/**
 * The refusal a preview is *mostly* about, for a notice line. A drag that meets one
 * 闸机 and one rail bed says the thing it met more of, rather than whichever the
 * rectangle happened to walk into first.
 */
export function dominantRefusal(preview: PlacementPreview): BlockRefusal | EquipmentRefusal | '' {
  const tally = new Map<string, number>()
  for (const reason of preview.refused.values()) tally.set(reason, (tally.get(reason) ?? 0) + 1)
  let best = ''
  let bestN = 0
  for (const [reason, n] of tally) if (n > bestN) [best, bestN] = [reason, n]
  return best as BlockRefusal | EquipmentRefusal | ''
}

/** A refused **block**, in the words the notice bar uses.
 *
 * `blockers` names the pieces standing in the way, so an `equipment` refusal
 * says which conflict it is (`被闸机阻挡`) rather than only saying the cell
 * is held. Kept verbatim without blockers so the reason stays searchable. */
export function blockRefusalNotice(reason: BlockRefusal | EquipmentRefusal | '', blockers: readonly Module[] = []): string {
  const base = (() => {
    switch (reason) {
      case 'opening':
        return msg('keep_openings_clear_do_not_cover_stairs_escalators_or_entrances_')
      case 'equipment':
        return msg('equipment_occupies_this_cell_move_or_remove_it_before_placing_a_')
      case 'track':
        return msg('cannot_place_blocks_on_track')
      default:
        return msg('cannot_place_a_block_in_this_cell')
    }
  })()
  if (reason !== 'equipment' || blockers.length === 0) return base
  return msg('value_blocked_by_value', base, blockerLabels(blockers))
}

/**
 * The placed pieces a refused preview names: `colliderIds` resolved back to
 * modules, in document order. The ghost already boxes these ids in red; the
 * notice prints their names beside it, so the two read as one answer.
 */
export function previewBlockers(station: PlacementDoc, preview: PlacementPreview): Module[] {
  const out: Module[] = []
  for (const id of preview.colliderIds) {
    const m = station.modules.find((mod) => mod.id === id)
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

/**
 * One notice line for a whole refused preview: the dominant reason, with the
 * offending pieces named. A block drag that meets a 闸机 says the 闸机; an
 * equipment run says the same through its own `equipmentRefusalNotice`.
 */
export function previewNotice(station: PlacementDoc, preview: PlacementPreview): string {
  const reason = dominantRefusal(preview)
  if (reason === '') return ''
  const blockers = previewBlockers(station, preview)
  // Block-only reasons (and the block-side `equipment`) read from the block
  // table; every other equipment reason reads from its own.
  if (reason === 'opening' || reason === 'track' || reason === 'equipment') return blockRefusalNotice(reason, blockers)
  return equipmentRefusalNotice(reason as EquipmentRefusal, blockers)
}
