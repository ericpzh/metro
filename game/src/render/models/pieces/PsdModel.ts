import { t } from '../../../sim/i18n.ts'
// Platform screen door builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { bindArtworkTexture } from '../../artwork.ts'
import { PieceBuilder, canvasTexture, slab, finishSlab, plate, ownedMaterial, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { psdFullHeight, PSD_HALF_HEIGHT, PSD_FULL_DOOR_WIDTH_SCALE, PSD_WALL_OFFSET, PSD_BASE_DEPTH } from '../../../sim/constants.ts'
import { drawPsdBand, drawPsdDoorBand, drawPsdWarning, drawPsdArrow } from './PsdDecals.ts'
import { doorWidthAt, doorRunOffsets, trainScaleForStorey } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'
import { finishPsdHousing } from './PsdHousing.ts'
import { drawPsdHeader, psdHeaderInfo, PSD_HEADER_HEIGHT, PSD_HEADER_PIXELS } from './PsdHeader.ts'

/* ------------------------------------------------------------ platform door */

/** Platform screen doors (站台门) along a `platform-edge` run. */
export function buildPsd(ctx: ModuleContext, mod: Extract<Module, { type: 'platform-edge' }>, fixedSpan?: readonly [number, number], housingOnly = false): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // Local frame: the group sits on the origin cell's centre, the run along +x,
  // one cell deep. `side` says which way the track lies (left = local −y), so
  // the screen faces it.
  const x0 = fixedSpan?.[0] ?? -0.5
  const len = fixedSpan ? fixedSpan[1] - fixedSpan[0] : mod.w
  const z0 = 1
  const toward = mod.cfg.side === 'right' ? 1 : -1
  const yWall = toward * PSD_WALL_OFFSET
  const cx = x0 + len / 2

  // The line decides the door cadence; the screen is cut open where it lands.
  const line = ctx.data.lines.find((l) => l.id === mod.cfg.line) ?? ctx.data.lines[0]
  const colour = line?.colour ?? '#1b6fd6'
  const name = ctx.data.name || t('metro_station')
  const nameEn = ctx.data.nameEn || ''
  const headerInfo = psdHeaderInfo(line, mod, ctx.data.name)
  const cars = line?.cars ?? 6
  const stock = (line?.stock ?? 'B') as StockClass
  // 屏蔽门 全高 / 半高. The half-height screen (半高) stands 1.5 m and carries
  // the line header as stickers on its glass instead of a printed top band; the
  // full-height screen keeps the storey-tall glass and the header band above it.
  // §5.9: the safety line belongs to the platform even when its screen is absent.
  if (!fixedSpan) {
    const yellow = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0xffc52e, roughness: 0.85 }));
    slab(g, yellow, cx, yWall - toward * 0.16, z0 + 0.003, len, 0.10, 0.006).name = 'platform-yellow-line'
  }
  if ((mod.cfg.psd ?? line?.psd) === 'none') {
    g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
    g.rotation.z = (mod.rot ?? 0) * Math.PI / 2
    return g
  }
  const gridHeight = 5
  const fullHeight = psdFullHeight(gridHeight)
  const modelScale = line?.modelScale ?? trainScaleForStorey(gridHeight)
  const half = (mod.cfg.psd ?? line?.psd) === 'half'
  // Widen the screen opening without moving its train-aligned centre (§1.13).
  // The half-height cap is part of the total height, above the black rail.
  const halfRailTop = PSD_HALF_HEIGHT - 0.05
  const headerH = 0.6
  // Glazing uses all clearance below the top-mounted information plate.
  const doorH = half ? halfRailTop - 0.12 : fullHeight - 0.05 - headerH
  const glassH = doorH
  const glassMid = z0 + glassH / 2
  const leafMid = z0 + doorH / 2
  // Single glass surfaces avoid competing front/back faces at grazing angles.
  const fixedGlass = housingOnly ? mats.glass : ownedMaterial(ctx, mats.glass.clone())
  const movingGlass = housingOnly ? mats.tintedGlass : ownedMaterial(ctx, mats.tintedGlass.clone())
  const fullHeightIndicator = housingOnly ? mats.glow : ownedMaterial(ctx, new THREE.MeshStandardMaterial({
    color: 0xffd21c, emissive: 0xffd21c, emissiveIntensity: 0.7, roughness: 0.23,
  }))
  if (!housingOnly) {
    fixedGlass.depthWrite = false
    movingGlass.depthWrite = false
    // PSDs can sit flush with a platform wall. Keep their transparent panes just
    // ahead in the depth buffer so the wall behind does not shimmer through them.
    fixedGlass.polygonOffset = true
    fixedGlass.polygonOffsetFactor = -1
    fixedGlass.polygonOffsetUnits = -1
    movingGlass.polygonOffset = true
    movingGlass.polygonOffsetFactor = -1
    movingGlass.polygonOffsetUnits = -1
  }
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
  const widthAt = (dx: number) => doorWidthAt({ stock, cars, modelScale }, dx + i0 - x0 - bedW / 2) * (half ? 1 : PSD_FULL_DOOR_WIDTH_SCALE)
  const openings = fixedSpan ? [] : doorRunOffsets({ stock, cars, modelScale }, bedW)
    .map((at) => at - i0 + x0)
    .filter((dx) => dx - widthAt(dx) / 2 > x0 + 0.1 && dx + widthAt(dx) / 2 < x0 + len - 0.1)
    .sort((a, b) => a - b)

  // Sill and head run the full length; the glass itself is broken at the doors.
  // Keep the platform-side edge fixed, and extend the flush sill beneath the
  // full slide lane so neither bank exposes the trench under its moving doors.
  const fixedFrameDepth = half ? 0.10 : 0.14
  const slideOffset = fixedFrameDepth / 2
  const sillTrackReach = slideOffset + (half ? 0.10 : 0.12) + 0.01
  const sillDepth = PSD_BASE_DEPTH / 2 + sillTrackReach
  const sillY = yWall + toward * (sillTrackReach - PSD_BASE_DEPTH / 2) / 2
  slab(g, mats.black, cx, sillY, z0 - 0.01, len, sillDepth, 0.02).name = 'psd-threshold'
  const foundationBottom = z0 - 1, foundationTop = z0 - .02
  finishSlab(g, ctx.finish('floor.concrete'), cx, sillY, (foundationTop + foundationBottom) / 2, len, sillDepth, foundationTop - foundationBottom).name = 'psd-concrete-foundation'
  if (!half) {
    // A deeper equipment/signage fascia, fitted to the existing full-height envelope.
    const headerBottom = glassH
    const headerZ = z0 + headerBottom + headerH / 2
    slab(g, mats.white, cx, yWall, headerZ, len, 0.24, headerH).name = 'psd-info-housing'
    slab(g, mats.black, cx, yWall, z0 + fullHeight - 0.025, len, 0.28, 0.05)
    // Station panels sit above train-aligned doorways; route panels fill
    // the fixed spans between them. Both face the platform only (§5.9).
    if (!fixedSpan) {
      const headerMaterial = (kind: 'route' | 'station') => {
        const map = canvasTexture(1024, PSD_HEADER_PIXELS, c => drawPsdHeader(c, kind, colour, headerInfo, name, nameEn))
        bindArtworkTexture(g, map, (c, data) => {
          const next = data.lines.find(l => l.id === mod.cfg.line) ?? data.lines[0]
          drawPsdHeader(c, kind, next?.colour ?? '#1b6fd6', psdHeaderInfo(next, mod, data.name), data.name || t('metro_station'), data.nameEn || '')
        })
        return ownedMaterial(ctx, new THREE.MeshBasicMaterial({map, side:THREE.FrontSide}))
      }
      const routeMat = headerMaterial('route'), stationMat = headerMaterial('station')
      const headerPanel = (a: number, b: number, station: boolean) => {
        if (b - a < 0.05) return
        const panel = plate(g, station ? stationMat : routeMat, b - a, headerH,
          (a + b) / 2, yWall - toward * 0.13, headerZ, platYaw)
        panel.name = station ? 'psd-station-header' : 'psd-route-header'
        panel.renderOrder = 1
      }
      let start = x0
      for (const dx of openings) {
        const doorW = widthAt(dx)
        headerPanel(start, dx - doorW / 2, false)
        headerPanel(dx - doorW / 2, dx + doorW / 2, true)
        start = dx + doorW / 2
      }
      headerPanel(start, x0 + len, false)
    }
    // The fascia's bottom edge follows the bound line colour.
    const bandMap = housingOnly ? null : canvasTexture(2,2,c=>{c.fillStyle=colour;c.fillRect(0,0,2,2)})
    if (bandMap) bindArtworkTexture(g,bandMap,(c,data)=>{
      c.fillStyle=(data.lines.find(l=>l.id===mod.cfg.line)??data.lines[0])?.colour??'#1b6fd6'
      c.fillRect(0,0,2,2)
    })
    // A tiny live ink texture keeps the atlas/material key stable on recolour;
    // changing a shared solid material would force station-wide re-bucketing.
    const lineBand = bandMap ? ownedMaterial(ctx,new THREE.MeshBasicMaterial({map:bandMap})) : mats.white
    slab(g, lineBand, cx, yWall - toward * 0.13, z0 + headerBottom + 0.012, len, 0.03, 0.025).name='psd-line-colour-band'

  }
  // The red "mind the gap" threshold, just under the doors so it never crosses
  // an opening.
  slab(g, mats.gateRed, cx, yWall, z0 + 0.003, len, 0.03, 0.006)

  // Fixed glass infill: everything except the door openings, so an open door
  // actually shows the track instead of a wall of glass. A half screen prints
  // the line header as a sticker on each fixed panel — the top band it loses is
  // moved down onto the glass, which is where the reference art puts it.
  const stickerMap = half && !fixedSpan ? canvasTexture(2048, PSD_HEADER_PIXELS, (c) => {
    drawPsdHeader(c, 'route', colour, headerInfo, name, nameEn)
    c.save(); c.translate(1024, 0)
    drawPsdHeader(c, 'station', colour, headerInfo, name, nameEn)
    c.restore()
  }) : null
  if (stickerMap) bindArtworkTexture(g, stickerMap, (c, data) => {
    const next = data.lines.find(l => l.id === mod.cfg.line) ?? data.lines[0]
    const info = psdHeaderInfo(next, mod, data.name), ink = next?.colour ?? '#1b6fd6'
    drawPsdHeader(c, 'route', ink, info, data.name || t('metro_station'), data.nameEn || '')
    c.save(); c.translate(1024,0)
    drawPsdHeader(c, 'station', ink, info, data.name || t('metro_station'), data.nameEn || '')
    c.restore()
  })
  const stickerMat = stickerMap ? ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: stickerMap, side: THREE.FrontSide })) : null
  const bandMat = half || housingOnly ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 128, drawPsdBand), side: THREE.FrontSide }))
  if (bandMat?.map) bandMat.map.wrapS = THREE.RepeatWrapping
  const doorBandMat = half || fixedSpan ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(640, 128, drawPsdDoorBand), side: THREE.FrontSide }))
  const warningMat = half || fixedSpan ? null : ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(640, 480, drawPsdWarning), transparent: true, depthWrite: false, side: THREE.FrontSide }))
  const arrowMats = half || fixedSpan ? [] : [-1, 1].map((s) => ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, (c) => drawPsdArrow(c, toward < 0 ? -s : s)), transparent: true, depthWrite: false, side: THREE.FrontSide })))
  // Safety vinyl follows the glazed height, including compact train profiles.
  const decalScale = Math.min(1, glassH / (2.95 - 0.05 - PSD_HEADER_HEIGHT))
  const band = (a: number, b: number, y: number, door = false): THREE.Mesh | undefined => {
    const mat = door ? doorBandMat : bandMat
    if (!mat) return
    const stripe = plate(g, mat, b - a, 0.15 * decalScale, (a + b) / 2, y, z0 + 1.12 * decalScale, platYaw)
    stripe.name = door ? 'psd-door-band' : 'psd-fixed-band'
    // Metre-scaled print: a long fixed pane must not stretch the lettering.
    const uv = stripe.geometry.getAttribute('uv')
    if (!door) for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (b - a) / 1.2)
    stripe.renderOrder = 2
    return stripe
  }
  const panel = (a: number, b: number): void => {
    const w = b - a
    if (w <= 0.05) return
    if (!housingOnly) plate(g, fixedGlass, w, glassH, a + w / 2, yWall, glassMid, 0).name = 'psd-fixed-glass'
    if (half) {
      slab(g, mats.black, a + w / 2, yWall, z0 + halfRailTop - 0.06, w, 0.08, 0.12).name = 'psd-fixed-rail'
      slab(g, mats.black, a + w / 2, yWall, z0 + PSD_HALF_HEIGHT - 0.025, w, 0.1, 0.05).name = 'psd-fixed-cap'
    }
    band(a, b, yWall - toward * 0.075)
    if (!half) {
      slab(g, mats.black, a + w / 2, yWall, z0 + 0.03, w, 0.12, 0.06)
      slab(g, mats.black, a + w / 2, yWall, z0 + glassH - 0.03, w, 0.12, 0.06)
    }
    if (!stickerMat) return
    // The paired header keeps its aspect, inset from the panel's mullions.
    const sw = Math.min(w - 0.24, 2.8)
    if (sw < 0.7) return
    const sticker = plate(g, stickerMat, sw, sw * (PSD_HEADER_PIXELS / 2048), a + w / 2, yWall - toward * (fixedFrameDepth / 2 + 0.002), glassMid, platYaw)
    sticker.name = 'psd-fixed-sticker'
    sticker.renderOrder = 1
  }
  let cursor = x0
  for (const dx of openings) {
    const doorW = widthAt(dx)
    panel(cursor, dx - doorW / 2)
    cursor = dx + doorW / 2
  }
  panel(cursor, x0 + len)

  // Mullions: a jamb at each side of every doorway, plus infill posts across the
  // wider fixed panels — never a bar across an opening.
  const postAt = (px: number): void => {
    slab(g, mats.black, px, yWall, glassMid, 0.08, fixedFrameDepth, glassH).name = 'psd-fixed-post'
  }
  if (!half) { postAt(x0 + 0.04); postAt(x0 + len - 0.04) }
  for (const dx of openings) {
    const doorW = widthAt(dx)
    postAt(dx - doorW / 2)
    postAt(dx + doorW / 2)
  }
  // One structural pillar separates each glass + doorway section. Its position
  // follows the door cadence rather than an unrelated fixed metre grid (§5.9).
  const pillars = [x0 + 0.08, ...openings.slice(1).map((dx, i) => (openings[i] + dx) / 2), x0 + len - 0.08]
  for (const px of pillars) {
    slab(g, mats.black, px, yWall, glassMid, 0.16, fixedFrameDepth, glassH).name = 'psd-section-pillar'
  }

  // Door leaves at the timetable's door centres. Each leaf is the tinted glass
  // panel plus its outer frame; both slide clear of the opening (doorW/2) as the
  // train berths, the tinted panel parking behind the fixed glass beside it.
  // The sliding lane is behind the fixed screen, towards the track.
  // The glass meets the track-side face of the fixed pillars exactly.
  const leafY = yWall + toward * slideOffset
  const leaves: THREE.Mesh[] = []
  g.userData.line = mod.cfg.line
  for (const dx of openings) {
    const doorW = widthAt(dx)
    for (const s of [-1, 1]) {
      const overlap = 0.20
      const leafW = doorW / 2 + overlap
      const leafX = dx + s * leafW / 2
      // Exact half-opening widths meet at the centre; the inner seals cover the seam.
      const glass = plate(g, movingGlass, leafW, doorH, leafX, leafY, leafMid, 0)
      glass.name = 'psd-door-glass'
      const frameMat = mats.black
      const frame = slab(g, frameMat, dx + s * (doorW / 2 + overlap - 0.03), leafY, leafMid, 0.06, half ? 0.06 : 0.12, doorH)
      registerDoorLeaf(glass, s, doorW / 2, leaves)
      registerDoorLeaf(frame, s, doorW / 2, leaves)
      const meetingFrame = slab(g, mats.black, dx + s * 0.015, leafY, leafMid, 0.03, half ? 0.06 : 0.12, doorH)
      meetingFrame.name = 'psd-door-meeting-frame'
      registerDoorLeaf(meetingFrame, s, doorW / 2, leaves)
      if (half) {
        const rail = slab(g, mats.black, leafX, leafY, z0 + halfRailTop - 0.06, leafW, 0.08, 0.12)
        rail.name = 'half-door-rail'
        registerDoorLeaf(rail, s, doorW / 2, leaves)
        const cap = slab(g, mats.black, leafX, leafY, z0 + PSD_HALF_HEIGHT - 0.025, leafW, 0.1, 0.05)
        cap.name = 'half-door-cap'
        registerDoorLeaf(cap, s, doorW / 2, leaves)
      }
      if (!half) {
        for (const z of [z0 + 0.03, z0 + doorH - 0.03]) {
          registerDoorLeaf(slab(g, frameMat, leafX, leafY, z, leafW, 0.12, 0.06), s, doorW / 2, leaves)
        }
        const stripe = band(leafX - leafW / 2, leafX + leafW / 2, leafY - toward * 0.001, true)
        if (stripe) registerDoorLeaf(stripe, s, doorW / 2, leaves)
        if (warningMat) {
          const warningW = Math.min(0.52 * decalScale, leafW - 0.1)
          const warning = plate(g, warningMat, warningW, warningW * 0.75, leafX, leafY - toward * 0.002, z0 + 1.88 * decalScale, platYaw)
          warning.name = 'psd-door-warning'
          warning.renderOrder = 3
          registerDoorLeaf(warning, s, doorW / 2, leaves)
        }
        const arrowSize = Math.min(0.24 * decalScale, leafW - 0.1)
        const arrow = plate(g, arrowMats[s < 0 ? 0 : 1], arrowSize, arrowSize, leafX, leafY - toward * 0.002, z0 + 1.48 * decalScale, platYaw)
        arrow.name = 'psd-door-arrow'
        arrow.renderOrder = 3
        registerDoorLeaf(arrow, s, doorW / 2, leaves)
      }
    }
    // A raised oval amber lens in a small metal bezel, below the bilingual name.
    if (!half) {
      const lampZ = z0 + doorH + 0.085
      const oval = (material: THREE.Material, width: number, depth: number, height: number, face: number, z: number) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), material)
        mesh.scale.set(width / 2, depth / 2, height / 2)
        mesh.position.set(dx, yWall - toward * face, z)
        g.add(mesh)
        return mesh
      }
      oval(mats.steel, 0.19, 0.036, 0.09, 0.137, lampZ).name = 'psd-station-light-bezel'
      oval(fullHeightIndicator, 0.15, 0.05, 0.064, 0.155, lampZ).name = 'psd-station-light'
    }
  }
  // All moving opaque fittings sit track-side of their glass plane. The fixed
  // pillar meets that plane exactly, sealing the side without blocking the slide.
  for (const leaf of leaves) if (leaf.geometry instanceof THREE.BoxGeometry) {
    leaf.position.y += toward * leaf.geometry.parameters.height / 2
  }
  g.userData.doors = leaves
  // Sliding leaves retain independent faces so they still seal as they move.
  if (!fixedSpan) finishPsdHousing(g)
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2
  // 隐藏墙壁 fades the whole screen along with the block walls.
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name !== 'platform-yellow-line' && o.name !== 'psd-concrete-foundation') o.userData.wall = true
  })
  return g
}

export class PsdModel extends PieceBuilder {
  readonly kind = 'platform-edge'
  build(mod: Extract<Module, { type: 'platform-edge' }>): THREE.Group {
    return buildPsd(this.ctx, mod)
  }
}
