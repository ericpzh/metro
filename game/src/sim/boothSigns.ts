// Editable wall signs on the service booth's overhead frame (§5.7–5.8).
import { PANEL_MIN_H, mountedSignBoards, signBoardsOf, signBoardsPanel } from './sign.ts'
import type { Module } from './types.ts'

type WallSign = Extract<Module, { type: 'sign' }>
type Booth = Extract<Module, { type: 'booth' }>

/** Align the sign's top with the booth header, rather than the glazing below it. */
export const BOOTH_SIGN_PANEL_Z = 2.4 - PANEL_MIN_H / 2

/** Keep the printed wall sheet clear of its backing without a housing. */
export const WALL_SIGN_STAND_OFF = 0.003

function faceAnchor(booth: Booth, rot: number): { x: number; y: number; z: number; rot: number } {
  const cx = Math.floor(booth.x + booth.w / 2 - 0.5)
  const cy = Math.floor(booth.y + booth.h / 2 - 0.5)
  switch (rot) {
    case 0: return { x: cx, y: booth.y + booth.h, z: booth.z, rot }
    case 1: return { x: booth.x - 1, y: cy, z: booth.z, rot }
    case 2: return { x: cx, y: booth.y - 1, z: booth.z, rot }
    default: return { x: booth.x + booth.w, y: cy, z: booth.z, rot: 3 }
  }
}

/** `rot` folded into 0–3, so a legacy or forged turn still names one face. */
function normRot(rot: number | undefined): number {
  return ((rot ?? 0) % 4 + 4) % 4
}

/**
 * Point at either booth's frame: centre the board on the nearest outer face.
 *
 * `boothId` is the booth the **pointer already picked** (`boothSignAim`): aiming at
 * the booth's own board, or at its frame from a grazing angle, must snap to the
 * booth the player can see rather than to whatever floor the ray found behind it.
 * Without an id the pointer's own surface point decides, which is what keeps this
 * honest for a carried piece and for a head-less test.
 */
export function snapSignToBooth(
  modules: readonly Module[], sign: WallSign, point: readonly [number, number], hitZ: number, boothId?: string,
): WallSign {
  const { boothId: _oldBooth, boothOffset: _oldOffset, ...cfg } = sign.cfg
  const free = { ...sign, cfg }
  if (sign.cfg.mount !== 'wall') return free
  const booth = boothId !== undefined
    ? modules.find((m): m is Booth => m.type === 'booth' && m.id === boothId)
    : modules.find((m): m is Booth => m.type === 'booth'
      && hitZ >= m.z && hitZ <= m.z + 3
      && point[0] >= m.x - 0.2 && point[0] <= m.x + m.w + 0.2
      && point[1] >= m.y - 0.2 && point[1] <= m.y + m.h + 0.2)
  if (!booth) return free
  const faces = [
    { rot: 2, distance: Math.abs(point[1] - booth.y) },
    { rot: 0, distance: Math.abs(point[1] - booth.y - booth.h) },
    { rot: 1, distance: Math.abs(point[0] - booth.x) },
    { rot: 3, distance: Math.abs(point[0] - booth.x - booth.w) },
  ]
  faces.sort((a, b) => a.distance - b.distance)
  const at = faceAnchor(booth, faces[0].rot)
  // Anchors stay on the save's integer grid; only the drawn centre needs the half-cell offset.
  const boothOffset = at.rot % 2 === 0
    ? { x: booth.x + booth.w / 2 - at.x - 0.5, y: 0 }
    : { x: 0, y: booth.y + booth.h / 2 - at.y - 0.5 }
  return { ...free, ...at, cfg: { ...cfg, boothId: booth.id, boothOffset } }
}

/**
 * True when the piece **is** the board bolted to that booth face: the right
 * centre cell, the right half-cell offset, and a mount of its own. This is the
 * part of the support rule the snap always satisfies; the printed width is the
 * part it can miss (`boothSignFits`).
 */
export function boothHoldsSign(booth: Module, sign: Module): boolean {
  if (booth.type !== 'booth' || sign.type !== 'sign' || sign.cfg.mount !== 'wall'
    || sign.cfg.boothId !== booth.id) return false
  const rot = normRot(sign.rot)
  const at = faceAnchor(booth, rot)
  return sign.x === at.x && sign.y === at.y && sign.z === at.z
    && (sign.cfg.boothOffset?.x ?? 0) === (rot % 2 === 0 ? booth.x + booth.w / 2 - at.x - 0.5 : 0)
    && (sign.cfg.boothOffset?.y ?? 0) === (rot % 2 === 1 ? booth.y + booth.h / 2 - at.y - 0.5 : 0)
}

/**
 * True when the printed board fits the header band of the face it is bolted to:
 * the frame runs `w - 0.36` on a ±y face and `h - 0.36` on a ±x face, so a wider
 * board would hang off the end of its backing.
 */
export function boothSignFits(booth: Module, sign: Module): boolean {
  if (booth.type !== 'booth' || sign.type !== 'sign') return false
  const rot = normRot(sign.rot)
  const width = signBoardsPanel(mountedSignBoards('wall', signBoardsOf(sign.cfg))).w
  return width <= (rot % 2 === 0 ? booth.w : booth.h) - 0.36
}

/** The attachment itself is the backing; no slab, wall block or ceiling rods. */
export function boothSupportsSign(booth: Module, sign: Module): boolean {
  return boothHoldsSign(booth, sign) && boothSignFits(booth, sign)
}
