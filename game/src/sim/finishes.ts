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
  look: 'granite' | 'concrete' | 'tile' | 'track' | 'baffle' | 'metal' | 'plaster' | 'enamel' | 'stainless' | 'soil'
  /** Base tint, hexadecimal. */
  tint: number
}

export const FINISH_LIST: readonly FinishDef[] = [
  // 地面 Floor finish — top face.
  { id: 'floor.granite', label: '花岗岩', family: 'floor', speed: 1.0, cover: false, look: 'granite', tint: 0xc9ccd1 },
  { id: 'floor.concrete', label: '水泥', family: 'floor', speed: 0.9, cover: false, look: 'concrete', tint: 0x8d9299 },
  { id: 'floor.tile', label: '地砖', family: 'floor', speed: 1.0, cover: false, look: 'tile', tint: 0xd7dbe1 },
  // 轨道 Track bed — a top-face variant that is not walkable (§4.3).
  { id: 'floor.track', label: '轨道床', family: 'track', speed: 0, cover: false, look: 'track', tint: 0x2c313a },
  // 覆土 Cover soil — earth above a tunnel: solid ground, but nobody walks on it.
  { id: 'floor.soil', label: '覆土', family: 'floor', speed: 0, cover: false, look: 'soil', tint: 0x232a34 },
  // 天花 Ceiling finish — bottom face.
  { id: 'ceil.baffle', label: '格栅天花', family: 'ceiling', speed: 1.0, cover: true, look: 'baffle', tint: 0xe8ebef },
  { id: 'ceil.metal', label: '金属吊顶', family: 'ceiling', speed: 1.0, cover: true, look: 'metal', tint: 0x6b7480 },
  // 墙面 Wall finish — n/e/s/w.
  { id: 'wall.plaster', label: '涂料', family: 'wall', speed: 1.0, cover: false, look: 'plaster', tint: 0xe4e6ea },
  { id: 'wall.enamel', label: '搪瓷板', family: 'wall', speed: 1.0, cover: false, look: 'enamel', tint: 0x2f7ef2 },
  { id: 'wall.stainless', label: '拉丝不锈钢', family: 'wall', speed: 1.0, cover: false, look: 'stainless', tint: 0x9aa2ab },
  { id: 'wall.soil', label: '土墙', family: 'wall', speed: 1.0, cover: false, look: 'soil', tint: 0x232a34 },
] as const

const BY_ID = new Map<FinishId, FinishDef>(FINISH_LIST.map((f) => [f.id, f]))

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
  top: 'floor.granite',
  bottom: 'ceil.baffle',
  n: 'wall.plaster',
  e: 'wall.plaster',
  s: 'wall.plaster',
  w: 'wall.plaster',
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
  return BY_ID.get('floor.granite') as FinishDef
}

export function finishLabel(id: FinishId): string {
  return finishDef(id).label
}

/** Finishes a paint brush may apply to a given face (the family's palette). */
export function finishesForFace(face: Face): FinishDef[] {
  if (face === 'top') return FINISH_LIST.filter((f) => f.family === 'floor' || f.family === 'track')
  if (face === 'bottom') return FINISH_LIST.filter((f) => f.family === 'ceiling')
  return FINISH_LIST.filter((f) => f.family === 'wall')
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
