// Platform screen door builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, canvasTexture, slab, plate, ownedMaterial, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { PSD_HALF_HEIGHT } from '../../../sim/constants.ts'
import { STOCK, doorRunOffsets } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/** A platform-screen header: white, a line band, and the direction sticker. */
function psdHeaderCanvas(colour: string, lineId: string, terminus: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#f4f6f8'
  g.fillRect(0, 0, 1024, 96)
  g.fillStyle = colour
  g.fillRect(0, 0, 1024, 18)
  g.fillStyle = '#ffffff'
  g.font = 'bold 44px "Microsoft YaHei", sans-serif'
  g.fillText('体育西路', 40, 66)
  g.font = '22px "Microsoft YaHei", sans-serif'
  g.fillText('Tiyu Xilu', 250, 66)
  // The line roundel.
  g.fillStyle = colour
  g.beginPath()
  g.arc(920, 58, 26, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = 'bold 30px sans-serif'
  g.textAlign = 'center'
  g.fillText(lineId, 920, 69)
  // Direction sticker. The destination is the line's own terminus for the
  // direction this screen serves (`mod.cfg.dir`), so the header reads the bound
  // line instead of a hardcoded place name. An unset terminus falls back to the
  // direction word.
  g.textAlign = 'left'
  g.fillStyle = '#1b6fd6'
  g.font = 'bold 22px "Microsoft YaHei", sans-serif'
  g.fillText(`◀ ${terminus}方向 →`, 470, 62)
  return c
}


/* ------------------------------------------------------------ platform door */

/** Platform screen doors (站台门) along a `platform-edge` run. */
function buildPsd(ctx: ModuleContext, mod: Extract<Module, { type: 'platform-edge' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // Local frame: the group sits on the origin cell's centre, the run along +x,
  // one cell deep. `side` says which way the track lies (left = local −y), so
  // the screen faces it.
  const x0 = -0.5
  const len = mod.w
  const z0 = 1
  const toward = mod.cfg.side === 'right' ? 1 : -1
  const yWall = toward * 0.34
  const cx = x0 + len / 2

  // The line decides the door cadence; the screen is cut open where it lands.
  const line = ctx.data.lines.find((l) => l.id === mod.cfg.line) ?? ctx.data.lines[0]
  const colour = line?.colour ?? '#1b6fd6'
  const lineId = line?.id ?? '2'
  // The header's destination is the bound line's terminus for this screen's
  // direction, so an up platform points where the up track runs and a down one
  // the other way (the terminus fields are the per-line inputs).
  const terminus =
    ((mod.cfg.dir === 'down' ? line?.downTerminus : line?.upTerminus) ?? '').trim() || (mod.cfg.dir === 'down' ? '下行' : '上行')
  const cars = line?.cars ?? 6
  const stock = (line?.stock ?? 'B') as StockClass
  const doorW = STOCK[stock].doorWidth
  // 屏蔽门 全高 / 半高. The half-height screen (半高) stands 1.5 m and carries
  // the line header as stickers on its glass instead of a printed top band; the
  // full-height screen keeps the storey-tall glass and the header band above it.
  const half = (mod.cfg.psd ?? line?.psd) === 'half'
  const doorH = half ? 1.15 : 2.5
  // Half stack from the local floor at z0: 0.12 sill + 1.26 glass + 0.12 cap.
  const glassH = half ? PSD_HALF_HEIGHT - 0.24 : 2.6
  const glassMid = half ? z0 + 0.12 + glassH / 2 : z0 + 1.45
  const leafMid = half ? z0 + 0.12 + doorH / 2 : z0 + 1.42
  const platYaw = toward < 0 ? Math.PI : 0
  // Openings that actually fall on this run, ascending. The cadence is measured
  // from the *consist* centre, which is the rail's run centre — not this edge's,
  // which may cover only part of the bed (a platform shorter than its rail, or a
  // run split by a wall). Anchoring on the rail is what keeps every opening on
  // the car door it exists to meet (§1.13); an edge that has lost its rail falls
  // back to assuming it is centred on the consist.
  const rail = mod.cfg.from ? ctx.data.modules.find((m) => m.id === mod.cfg.from) : undefined
  const bed = rail?.type === 'track' ? rail : undefined
  const bedW = bed?.w ?? len
  // The edge's own first cell, in rail-local metres along the run.
  const i0 = bed ? rotateLocal(-(bed.rot ?? 0), mod.x - bed.x, mod.y - bed.y)[0] : (bedW - len) / 2
  const openings = doorRunOffsets({ stock, cars }, bedW)
    .map((at) => at - i0 + x0)
    .filter((dx) => dx - doorW / 2 > x0 + 0.1 && dx + doorW / 2 < x0 + len - 0.1)
    .sort((a, b) => a - b)

  // Sill and head run the full length; the glass itself is broken at the doors.
  slab(g, mats.white, cx, yWall, z0 + 0.06, len, 0.18, 0.12)
  if (half) {
    // A low cap rail closes the half screen at 1.5 m.
    slab(g, mats.white, cx, yWall, z0 + PSD_HALF_HEIGHT - 0.06, len, 0.2, 0.12)
    slab(g, mats.darkSteel, cx, yWall, z0 + PSD_HALF_HEIGHT, len, 0.24, 0.05)
  } else {
    slab(g, mats.white, cx, yWall, z0 + 2.85, len, 0.24, 0.3)
    slab(g, mats.darkSteel, cx, yWall, z0 + 3.02, len, 0.28, 0.08)
    // The printed header faces the platform (away from the track), repeated along
    // the run so the station name and direction sticker recur as they really do.
    // FrontSide, not DoubleSide: the track side of a screen has no label, so the
    // sticker must not bleed through (mirrored) to the platform's back.
    const headerMap = canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus), 0, 0))
    headerMap.wrapS = THREE.RepeatWrapping
    headerMap.repeat.set(Math.max(1, Math.round(len / 10)), 1)
    const header = plate(
      g,
      ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: headerMap, side: THREE.FrontSide })),
      len,
      0.3,
      cx,
      yWall - toward * 0.13,
      z0 + 2.85,
      platYaw,
    )
    header.renderOrder = 1
    // The under-header light strip.
    slab(g, mats.glow, cx, yWall - toward * 0.12, z0 + 2.66, len, 0.03, 0.05)
  }
  // The red "mind the gap" threshold, just under the doors so it never crosses
  // an opening.
  slab(g, mats.gateRed, cx, yWall, z0 + 0.14, len, 0.03, 0.07)

  // Fixed glass infill: everything except the door openings, so an open door
  // actually shows the track instead of a wall of glass. A half screen prints
  // the line header as a sticker on each fixed panel — the top band it loses is
  // moved down onto the glass, which is where the reference art puts it.
  const stickerMap = half ? canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus), 0, 0)) : null
  const stickerMat = stickerMap ? ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: stickerMap, side: THREE.FrontSide })) : null
  const panel = (a: number, b: number): void => {
    const w = b - a
    if (w <= 0.05) return
    slab(g, mats.glass, a + w / 2, yWall, glassMid, w, 0.04, glassH)
    if (!stickerMat) return
    // The 1024×96 header keeps its aspect, inset from the panel's mullions.
    const sw = Math.min(w - 0.24, 2.8)
    if (sw < 0.7) return
    const sticker = plate(g, stickerMat, sw, sw * (96 / 1024), a + w / 2, yWall - toward * 0.05, glassMid, platYaw)
    sticker.renderOrder = 1
  }
  let cursor = x0
  for (const dx of openings) {
    panel(cursor, dx - doorW / 2)
    cursor = dx + doorW / 2
  }
  panel(cursor, x0 + len)

  // Mullions: a jamb at each side of every doorway, plus infill posts across the
  // wider fixed panels — never a bar across an opening.
  const postAt = (px: number): void => {
    slab(g, mats.white, px, yWall, glassMid, 0.08, 0.14, glassH)
  }
  for (const dx of openings) {
    postAt(dx - doorW / 2)
    postAt(dx + doorW / 2)
  }
  for (let px = x0 + 2.4; px < x0 + len; px += 2.4) {
    if (openings.some((dx) => Math.abs(px - dx) < doorW / 2 + 0.1)) continue
    postAt(px)
  }

  // Door leaves at the timetable's door centres. Each leaf is the tinted glass
  // panel plus its outer frame; both slide clear of the opening (doorW/2) as the
  // train berths, the tinted panel parking over the fixed glass beside it. They
  // sit a hair on the platform side of the fixed glass so they never z-fight it.
  const leafY = yWall - toward * 0.05
  const leaves: THREE.Mesh[] = []
  g.userData.line = mod.cfg.line
  for (const dx of openings) {
    for (const s of [-1, 1]) {
      const glass = slab(g, mats.tintedGlass, dx + (s * doorW) / 4, leafY, leafMid, doorW / 2 - 0.02, 0.05, doorH)
      const frame = slab(g, mats.white, dx + (s * doorW) / 2, leafY, leafMid, 0.06, 0.12, doorH)
      registerDoorLeaf(glass, s, doorW / 2, leaves)
      registerDoorLeaf(frame, s, doorW / 2, leaves)
    }
    // Green "open" indicator above each pair.
    plate(g, mats.ledGreen, 0.3, 0.06, dx, yWall - toward * 0.14, half ? z0 + 1.34 : z0 + 2.7, platYaw)
  }
  g.userData.doors = leaves
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2
  // 隐藏墙壁 fades the whole screen along with the block walls.
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.wall = true
  })
  return g
}

export class PsdModel extends PieceBuilder {
  readonly kind = 'platform-edge'
  build(mod: Extract<Module, { type: 'platform-edge' }>): THREE.Group {
    return buildPsd(this.ctx, mod)
  }
}

