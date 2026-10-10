// Platform screen door builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, canvasTexture, slab, plate, ownedMaterial, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { PSD_FULL_HEIGHT, PSD_HALF_HEIGHT, PSD_FULL_DOOR_WIDTH_SCALE } from '../../../sim/constants.ts'
import { drawPsdBand, drawPsdDoorBand, drawPsdWarning, drawPsdArrow } from './PsdDecals.ts'
import { STOCK, doorRunOffsets } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/** A platform-screen header: white, a line band, and the direction sticker. */
function psdHeaderCanvas(colour: string, lineId: string, terminus: string, name: string, nameEn: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#f4f6f8'
  g.fillRect(0, 0, 1024, 96)
  g.fillStyle = colour
  g.fillRect(0, 0, 1024, 18)
  g.fillStyle = '#20262a'
  g.font = 'bold 38px "Microsoft YaHei", sans-serif'
  g.fillText(name, 40, 56, 370)
  // Leave clear space above the lower fascia; the English baseline used to sit
  // under the rail and get clipped off in the rendered sign.
  g.font = '18px "Microsoft YaHei", sans-serif'
  g.fillText(nameEn, 40, 80, 370)
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
  g.fillText(`◀ ${terminus}方向`, 470, 56)
  return c
}


/* ------------------------------------------------------------ platform door */

/** Platform screen doors (站台门) along a `platform-edge` run. */
export function buildPsd(ctx: ModuleContext, mod: Extract<Module, { type: 'platform-edge' }>, fixedSpan?: readonly [number, number]): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // Local frame: the group sits on the origin cell's centre, the run along +x,
  // one cell deep. `side` says which way the track lies (left = local −y), so
  // the screen faces it.
  const x0 = fixedSpan?.[0] ?? -0.5
  const len = fixedSpan ? fixedSpan[1] - fixedSpan[0] : mod.w
  const z0 = 1
  const toward = mod.cfg.side === 'right' ? 1 : -1
  const yWall = toward * 0.34
  const cx = x0 + len / 2

  // The line decides the door cadence; the screen is cut open where it lands.
  const line = ctx.data.lines.find((l) => l.id === mod.cfg.line) ?? ctx.data.lines[0]
  const colour = line?.colour ?? '#1b6fd6'
  const lineId = line?.id ?? '2'
  const name = ctx.data.name || '地铁站'
  const nameEn = ctx.data.nameEn || ''
  // The header's destination is the bound line's terminus for this screen's
  // direction, so an up platform points where the up track runs and a down one
  // the other way (the terminus fields are the per-line inputs).
  const terminus =
    ((mod.cfg.dir === 'down' ? line?.downTerminus : line?.upTerminus) ?? '').trim() || (mod.cfg.dir === 'down' ? '下行' : '上行')
  const cars = line?.cars ?? 6
  const stock = (line?.stock ?? 'B') as StockClass
  // 屏蔽门 全高 / 半高. The half-height screen (半高) stands 1.5 m and carries
  // the line header as stickers on its glass instead of a printed top band; the
  // full-height screen keeps the storey-tall glass and the header band above it.
  const half = (mod.cfg.psd ?? line?.psd) === 'half'
  // Widen the screen opening without moving its train-aligned centre (§1.13).
  const doorW = STOCK[stock].doorWidth * (half ? 1 : PSD_FULL_DOOR_WIDTH_SCALE)
  const doorH = half ? PSD_HALF_HEIGHT - 0.24 : 2.5
  // Half stack from the local floor at z0: 0.12 sill + 1.26 glass + 0.12 cap.
  const glassH = half ? PSD_HALF_HEIGHT - 0.24 : doorH
  const glassMid = z0 + 0.12 + glassH / 2
  const leafMid = z0 + 0.12 + doorH / 2
  // Single glass surfaces avoid competing front/back faces at grazing angles.
  const fixedGlass = ownedMaterial(ctx, mats.glass.clone())
  const movingGlass = ownedMaterial(ctx, mats.tintedGlass.clone())
  const fullHeightIndicator = ownedMaterial(ctx, new THREE.MeshBasicMaterial({ color: 0xffd43b, side: THREE.DoubleSide }))
  fixedGlass.depthWrite = false
  movingGlass.depthWrite = false
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
  const openings = fixedSpan ? [] : doorRunOffsets({ stock, cars }, bedW)
    .map((at) => at - i0 + x0)
    .filter((dx) => dx - doorW / 2 > x0 + 0.1 && dx + doorW / 2 < x0 + len - 0.1)
    .sort((a, b) => a - b)

  // Sill and head run the full length; the glass itself is broken at the doors.
  slab(g, mats.white, cx, yWall, z0 + 0.06, len, 0.18, 0.12)
  if (!half) {
    // A deeper equipment/signage fascia, fitted to the existing full-height envelope.
    const headerBottom = 0.12 + doorH
    const headerH = PSD_FULL_HEIGHT - headerBottom - 0.05
    const headerZ = z0 + headerBottom + headerH / 2
    slab(g, mats.white, cx, yWall, headerZ, len, 0.24, headerH)
    slab(g, mats.black, cx, yWall, z0 + PSD_FULL_HEIGHT - 0.025, len, 0.28, 0.05)
    // The printed header faces the platform (away from the track), repeated along
    // the run so the station name and direction sticker recur as they really do.
    // FrontSide, not DoubleSide: the track side of a screen has no label, so the
    // sticker must not bleed through (mirrored) to the platform's back.
    if (!fixedSpan) {
      const headerMap = canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus, name, nameEn), 0, 0))
      headerMap.wrapS = THREE.RepeatWrapping
      headerMap.repeat.set(Math.max(1, Math.round(len / 4)), 1)
      const header = plate(
        g,
        ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: headerMap, side: THREE.FrontSide })),
        len,
        headerH,
        cx,
        yWall - toward * 0.13,
        headerZ,
        platYaw,
      )
      header.renderOrder = 1
    }
    // The under-header light strip.
    slab(g, mats.black, cx, yWall, z0 + headerBottom, len, 0.18, 0.06)
    slab(g, mats.glow, cx, yWall - toward * 0.13, z0 + headerBottom + 0.04, len, 0.03, 0.025)
  }
  // The red "mind the gap" threshold, just under the doors so it never crosses
  // an opening.
  slab(g, mats.gateRed, cx, yWall, z0 + 0.14, len, 0.03, 0.07)

  // Fixed glass infill: everything except the door openings, so an open door
  // actually shows the track instead of a wall of glass. A half screen prints
  // the line header as a sticker on each fixed panel — the top band it loses is
  // moved down onto the glass, which is where the reference art puts it.
  const stickerMap = half && !fixedSpan ? canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus, name, nameEn), 0, 0)) : null
  const stickerMat = stickerMap ? ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: stickerMap, side: THREE.FrontSide })) : null
  const bandMat = half ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 128, drawPsdBand), side: THREE.FrontSide }))
  if (bandMat?.map) bandMat.map.wrapS = THREE.RepeatWrapping
  const doorBandMat = half || fixedSpan ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(640, 128, drawPsdDoorBand), side: THREE.FrontSide }))
  const warningMat = half || fixedSpan ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(640, 480, drawPsdWarning), transparent: true, depthWrite: false, side: THREE.FrontSide }))
  const arrowMats = half || fixedSpan ? [] : [-1, 1].map((s) => ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, (c) => drawPsdArrow(c, toward < 0 ? -s : s)), transparent: true, depthWrite: false, side: THREE.FrontSide })))
  const band = (a: number, b: number, y: number, door = false): THREE.Mesh | undefined => {
    const mat = door ? doorBandMat : bandMat
    if (!mat) return
    const stripe = plate(g, mat, b - a, 0.15, (a + b) / 2, y, z0 + 1.12, platYaw)
    // Metre-scaled print: a long fixed pane must not stretch the lettering.
    const uv = stripe.geometry.getAttribute('uv')
    if (!door) for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (b - a) / 1.2)
    stripe.renderOrder = 2
    return stripe
  }
  const panel = (a: number, b: number): void => {
    const w = b - a
    if (w <= 0.05) return
    plate(g, fixedGlass, w, glassH, a + w / 2, yWall, glassMid, 0).name = 'psd-fixed-glass'
    if (half) {
      slab(g, mats.white, a + w / 2, yWall, z0 + PSD_HALF_HEIGHT - 0.06, w, 0.08, 0.12).name = 'psd-fixed-rail'
      slab(g, mats.darkSteel, a + w / 2, yWall, z0 + PSD_HALF_HEIGHT + 0.025, w, 0.1, 0.05).name = 'psd-fixed-cap'
    }
    band(a, b, yWall - toward * 0.075)
    if (!half) {
      slab(g, mats.black, a + w / 2, yWall, z0 + 0.15, w, 0.12, 0.06)
      slab(g, mats.black, a + w / 2, yWall, z0 + 0.12 + glassH - 0.03, w, 0.12, 0.06)
    }
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
    slab(g, half ? mats.white : mats.black, px, yWall, glassMid, 0.08, half ? 0.06 : 0.14, glassH).name = 'psd-fixed-post'
  }
  if (!half) { postAt(x0 + 0.04); postAt(x0 + len - 0.04) }
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
  // Slim half-height fittings keep the slide lane close, with 1 cm cap clearance.
  const leafY = yWall - toward * (half ? 0.11 : 0.15)
  const leaves: THREE.Mesh[] = []
  g.userData.line = mod.cfg.line
  for (const dx of openings) {
    for (const s of [-1, 1]) {
      const leafX = dx + (s * doorW) / 4
      const leafW = doorW / 2
      // Exact half-opening widths meet at the centre; the inner seals cover the seam.
      const glass = plate(g, movingGlass, half ? leafW - 0.02 : leafW, doorH, leafX, leafY, leafMid, 0)
      glass.name = 'psd-door-glass'
      const frameMat = half ? mats.white : mats.black
      const frame = slab(g, frameMat, dx + s * (doorW / 2 - (half ? 0 : 0.03)), leafY, leafMid, 0.06, half ? 0.06 : 0.12, doorH)
      registerDoorLeaf(glass, s, doorW / 2, leaves)
      registerDoorLeaf(frame, s, doorW / 2, leaves)
      if (half) {
        const rail = slab(g, mats.white, leafX, leafY, z0 + PSD_HALF_HEIGHT - 0.06, leafW, 0.08, 0.12)
        rail.name = 'half-door-rail'
        registerDoorLeaf(rail, s, leafW, leaves)
        const cap = slab(g, mats.darkSteel, leafX, leafY, z0 + PSD_HALF_HEIGHT + 0.025, leafW, 0.1, 0.05)
        cap.name = 'half-door-cap'
        registerDoorLeaf(cap, s, leafW, leaves)
      }
      if (!half) {
        const seal = slab(g, mats.rubber, dx + s * 0.012, leafY, leafMid, 0.024, 0.12, doorH)
        registerDoorLeaf(seal, s, leafW, leaves)
        for (const z of [z0 + 0.15, z0 + 0.12 + doorH - 0.03]) {
          registerDoorLeaf(slab(g, frameMat, leafX, leafY, z, leafW, 0.12, 0.06), s, leafW, leaves)
        }
        const stripe = band(leafX - leafW / 2, leafX + leafW / 2, leafY - toward * 0.075, true)
        if (stripe) registerDoorLeaf(stripe, s, leafW, leaves)
        if (warningMat) {
          const warning = plate(g, warningMat, Math.min(0.52, leafW - 0.1), 0.39, leafX, leafY - toward * 0.076, z0 + 1.88, platYaw)
          warning.renderOrder = 3
          registerDoorLeaf(warning, s, leafW, leaves)
        }
        const arrow = plate(g, arrowMats[s < 0 ? 0 : 1], 0.24, 0.24, leafX, leafY - toward * 0.076, z0 + 1.48, platYaw)
        arrow.renderOrder = 3
        registerDoorLeaf(arrow, s, leafW, leaves)
      }
    }
    // Only full-height screens have an indicator, and it is yellow.
    if (!half) plate(g, fullHeightIndicator, 0.3, 0.06, dx, yWall - toward * 0.14, z0 + 2.7, platYaw)
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
