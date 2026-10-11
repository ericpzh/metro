import { msg } from './i18n.ts'
// Surface finishes — GAME-SPEC.md §4.3.
//
// Pure data, no DOM, no three. The *family* decides behaviour (a floor finish
// sets walk speed, a track bed cannot be walked on, a wall blocks), the finish
// inside the family decides look. The renderer reads the same table to pick a
// procedural material, so a finish cannot look like one thing and behave like
// another.
//
// Ids stay ASCII per §9.2 even though every label a player reads is Chinese.

import { packKey } from './types.ts'
import type { Cell, Face, FinishId } from './types.ts'

export type FinishFamily = 'floor' | 'ceiling' | 'wall' | 'track'

/**
 * The finish the ground under a run's truss is drawn in where no block was laid: the
 * run's own dark steel, so the filling meets the truss's underside in one body instead
 * of reading as concrete reaching up into the escalator. A stock finish, so a player
 * can paint a block's **bottom** face with it (`finishesForFace`) and get the same
 * look anywhere else they want it.
 */
export const RAMP_SOFFIT_FINISH = 'ceil.steel'
/** Unpainted construction and the initial material brush (§4.3). */
export const DEFAULT_MATERIAL = 'floor.concrete'

export interface FinishDef {
  id: FinishId
  /** Simplified Chinese, shown in the rail palette. */
  label: string
  family: FinishFamily
  /** Walk-speed multiplier on a top face. 0 = not walkable (track bed). */
  speed: number
  /** Rain cover / light, cosmetic in the base game (§4.3). */
  cover: boolean
  /** Which procedural base the renderer draws. */
  look: 'granite' | 'concrete' | 'marble' | 'limestone' | 'sandstone' | 'slate' | 'obsidian' | 'softwood' | 'hardwood' | 'tile' | 'track' | 'baffle' | 'metal' | 'steel' | 'plaster' | 'enamel' | 'stainless' | 'soil'
  /** Base tint, hexadecimal. */
  tint: number
}

export const FINISH_LIST: readonly FinishDef[] = [
  // 地面 Floor finish — top face.
  { id: 'floor.granite', label: msg('granite'), family: 'floor', speed: 1.0, cover: false, look: 'granite', tint: 0xc58d7a },
  { id: 'floor.concrete', label: msg('concrete'), family: 'floor', speed: 0.9, cover: false, look: 'concrete', tint: 0x8d9299 },
  { id: 'floor.marble', label: msg('marble'), family: 'floor', speed: 1, cover: false, look: 'marble', tint: 0xe4d6b9 },
  { id: 'floor.limestone', label: msg('limestone'), family: 'floor', speed: 1, cover: false, look: 'limestone', tint: 0xdcd4b9 },
  { id: 'floor.sandstone', label: msg('sandstone'), family: 'floor', speed: 1, cover: false, look: 'sandstone', tint: 0xc5a76a },
  { id: 'floor.slate', label: msg('slate'), family: 'floor', speed: 1, cover: false, look: 'slate', tint: 0x727773 },
  { id: 'floor.softwood', label: msg('softwood'), family: 'floor', speed: 1, cover: false, look: 'softwood', tint: 0xc9a36b },
  { id: 'floor.hardwood', label: msg('hardwood'), family: 'floor', speed: 1, cover: false, look: 'hardwood', tint: 0x805333 },
  { id: 'floor.tile', label: msg('floor_tiles'), family: 'floor', speed: 1.0, cover: false, look: 'tile', tint: 0xd7dbe1 },
  // 轨道 Track bed — a top-face variant that is not walkable (§4.3).
  { id: 'floor.track', label: msg('track_bed'), family: 'track', speed: 0, cover: false, look: 'track', tint: 0x2c313a },
  // 覆土 Cover soil — earth above a tunnel: solid ground, but nobody walks on it.
  { id: 'floor.soil', label: msg('earth_cover'), family: 'floor', speed: 0, cover: false, look: 'soil', tint: 0x232a34 },
  // 天花 Ceiling finish — bottom face.
  { id: 'ceil.baffle', label: msg('grille_ceiling'), family: 'ceiling', speed: 1.0, cover: true, look: 'baffle', tint: 0xe8ebef },
  { id: 'ceil.metal', label: msg('metal_ceiling'), family: 'ceiling', speed: 1.0, cover: true, look: 'metal', tint: 0x6b7480 },
  // 钢板: dark brushed steel, the finish a 楼梯 / 扶梯 soffit wears — and the one the
  // derived filling under a run's truss is drawn in, so the escalator reads as one
  // body from the step band down to the ground (`rampFillKeys`, `chunkMesher`'s `fill`).
  { id: RAMP_SOFFIT_FINISH, label: msg('steel'), family: 'ceiling', speed: 1.0, cover: true, look: 'steel', tint: 0x3c434c },
  // 墙面 Wall finish — n/e/s/w.
  { id: 'wall.plaster', label: msg('paint'), family: 'wall', speed: 1.0, cover: false, look: 'plaster', tint: 0xe4e6ea },
  { id: 'wall.enamel', label: msg('enamel_panels'), family: 'wall', speed: 1.0, cover: false, look: 'enamel', tint: 0x2f7ef2 },
  { id: 'wall.stainless', label: msg('stainless_steel'), family: 'wall', speed: 1.0, cover: false, look: 'stainless', tint: 0x9aa2ab },
  { id: 'wall.aluminum', label: msg('aluminum_panels'), family: 'wall', speed: 1, cover: false, look: 'metal', tint: 0xc2c8cd },
  { id: 'floor.obsidian', label: msg('obsidian'), family: 'floor', speed: 1.0, cover: false, look: 'obsidian', tint: 0x282b2a },
] as const

const BY_ID = new Map<FinishId, FinishDef>(FINISH_LIST.map((f) => [f.id, f]))
// Preserve earth walls in existing saves without keeping a duplicate palette tile.
BY_ID.set('wall.soil', { id: 'wall.soil', label: msg('earth_wall'), family: 'wall', speed: 1, cover: false, look: 'soil', tint: 0x232a34 })

/** A family block in the 材质 folder's palette, as it is headed there. */
export interface FinishGroup {
  /** Material category; independent of the legacy face family. */
  fam: 'stone' | 'metal' | 'wood' | 'other'
  /** The heading the folder prints over the block. */
  label: string
  items: FinishDef[]
}

/** Shared palette order for the rail and captures (§4.3). Every material paints every face. */
export function finishPaletteGroups(): FinishGroup[] {
  return [
    { fam: 'stone', label: msg('material_stone'), ids: ['floor.concrete', 'floor.granite', 'floor.marble', 'floor.limestone', 'floor.sandstone', 'floor.slate', 'floor.soil', 'floor.obsidian'] },
    { fam: 'metal', label: msg('material_metal'), ids: ['wall.stainless', RAMP_SOFFIT_FINISH, 'wall.aluminum', 'ceil.metal'] },
    { fam: 'wood', label: msg('material_wood'), ids: ['floor.softwood', 'floor.hardwood'] },
    { fam: 'other', label: msg('material_other'), ids: ['wall.enamel', 'wall.plaster', 'ceil.baffle', 'floor.track', 'floor.tile'] },
  ].map(({ fam, label, ids }) => ({ fam: fam as FinishGroup['fam'], label, items: ids.map((id) => finishDef(id)) }))
}

/**
 * Separator joining a stock finish id to a custom tint, e.g.
 * `wall.enamel#2f7ef2`. A custom-tinted finish is still a real finish: the base
 * id decides family, speed and look, the suffix only supplies the colour. That
 * keeps the per-face finish a plain string (no new cell field, no save
 * migration) while letting 搪瓷板 be painted any colour, one cell at a time.
 */
const TINT_SEP = '#'

/** A base finish id wearing a custom tint — `customFinishId('wall.enamel', 0xff8800)`. */
export function customFinishId(base: FinishId, colour: number): FinishId {
  const hex = (colour >>> 0).toString(16).padStart(6, '0').slice(-6)
  return `${base}${TINT_SEP}${hex}`
}

/** The stock finish a possibly-tinted id derives from (`wall.enamel#…` → `wall.enamel`). */
export function finishBaseId(id: FinishId): FinishId {
  const at = id.indexOf(TINT_SEP)
  return at < 0 ? id : id.slice(0, at)
}

/** The custom tint packed into a finish id, or null for a stock finish. */
export function finishTint(id: FinishId): number | null {
  const at = id.indexOf(TINT_SEP)
  if (at < 0) return null
  const n = Number.parseInt(id.slice(at + 1), 16)
  return Number.isFinite(n) ? n : null
}

/** Default finish for each face, used when a cell has no override. */
export const DEFAULT_FINISH: Record<Face, FinishId> = {
  top: DEFAULT_MATERIAL,
  bottom: DEFAULT_MATERIAL,
  n: DEFAULT_MATERIAL,
  e: DEFAULT_MATERIAL,
  s: DEFAULT_MATERIAL,
  w: DEFAULT_MATERIAL,
}

export function finishDef(id: FinishId): FinishDef {
  const exact = BY_ID.get(id)
  if (exact) return exact
  // A custom-tinted finish carries its colour in the id. Resolve the stock base
  // for behaviour and look, then override the tint, so a painted enamel wall
  // walks and collides exactly like the stock one.
  const base = BY_ID.get(finishBaseId(id))
  const tint = finishTint(id)
  if (base && tint !== null) return { ...base, id, tint }
  return BY_ID.get(DEFAULT_MATERIAL) as FinishDef
}

export function finishLabel(id: FinishId): string {
  return finishDef(id).label
}

/** Face families retain legacy behaviour and defaults, without restricting the brush. */
export function finishesForFace(_face: Face): FinishDef[] {
  return [...FINISH_LIST]
}

/** The finish actually wearing a given face of a cell. */
export function finishOf(cell: Pick<Cell, 'finish'>, face: Face): FinishId {
  return cell.finish?.[face] ?? DEFAULT_FINISH[face]
}

/** Walk-speed multiplier of the floor a cell presents on its top face. */
export function floorSpeed(cell: Pick<Cell, 'finish'>): number {
  return finishDef(finishOf(cell, 'top')).speed
}

/**
 * Index a cell list by the packed key the mesher uses, so a per-cell finish
 * lookup during meshing is O(1). Only cells that carry an override are stored.
 */
export function finishMapOf(cells: readonly Cell[]): Map<number, Partial<Record<Face, FinishId>>> {
  const out = new Map<number, Partial<Record<Face, FinishId>>>()
  for (const c of cells) if (c.finish) out.set(packKey(c.x, c.y, c.z), c.finish)
  return out
}
