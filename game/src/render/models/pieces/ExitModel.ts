import { buildShenzhenCanopy } from './ShenzhenExitCanopy.ts'
import { cityStyleFor } from '../../../sim/cityStyles.ts'
import type { StationData } from '../../../sim/types.ts'
import { t, tForLanguage } from '../../../sim/i18n.ts'
// Exit portal (出入口) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { modelNeighbours } from '../../modelNeighbours.ts'
import { PieceBuilder, finishSlab, canvasTexture, drawMetroMark, slab, plate, ownedMaterial, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, exitLandingBack, exitRunOpenings, exitSpan } from '../../../sim/exits.ts'
import { EXIT_BASE_HEIGHT } from './ExitLanding.ts'
import { DoorwayExitModel } from './DoorwayExitModel.ts'
import { GuidepostModel } from './StreetDecorModel.ts'
import type { Module } from '../../../sim/types.ts'
import { omitModelDetail, panelModelDetail, setModelDetail, surfaceModelDetail, panelStripModelDetail, tubeModelDetail } from '../../modelDetail.ts'

/**
 * The exit portal header: the metro logo, station name and the exit's name.
 */
export function exitHeaderCanvas(stationName: string, exitName: string, stationNameEn = '', width = 512, style: Partial<Pick<StationData, 'cityStyle' | 'lines'>> = {}): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const city = cityStyleFor(style.cityStyle)
  if (city.entrance === 'shenzhen') {
    drawShenzhenHeader(g, stationName, exitName, stationNameEn, width, style)
    return c
  }
  g.fillStyle = city.entranceColour
  g.fillRect(0, 0, width, 96)
  drawMetroMark(g, 34, 48, 46, '#ffffff', style.cityStyle)
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  g.font = 'bold 19px "Microsoft YaHei", sans-serif'
  g.fillText(tForLanguage('zh-CN', city.brandKey), 64, 39, 108)
  g.font = '11px Arial, sans-serif'
  g.fillText(t(city.brandEnglishKey), 64, 61, 108)

  // Keep long station names within the centre field, clear of the brand and exit.
  const station = (stationName || tForLanguage('zh-CN', 'metro')).trim()
  const stationLabel = station.endsWith(tForLanguage('zh-CN', 'station')) ? station : tForLanguage('zh-CN', 'value_station', station)
  g.textAlign = 'center'
  g.font = 'bold 29px "Microsoft YaHei", sans-serif'
  const stationCentre = width / 2 + 24
  const stationWidth = Math.max(198, width - 314)
  g.fillText(stationLabel, stationCentre, stationNameEn.trim() ? 36 : 48, stationWidth)
  if (stationNameEn.trim()) {
    g.font = '16px Arial, sans-serif'
    g.fillText(stationNameEn.trim(), stationCentre, 64, stationWidth)
  }

  // Preserve multi-character identifiers such as C1; named exits remain readable.
  const label = (exitName || tForLanguage('zh-CN', 'entrance')).trim()
  const identifier = label.match(/^([A-Za-z]\d*)(?:入口|出口|口)?$/)?.[1]
  if (identifier) {
    g.font = 'bold 40px Arial, sans-serif'
    g.fillText(identifier.toUpperCase(), width - 85, 48, 64)
    g.font = 'bold 21px "Microsoft YaHei", sans-serif'
    g.fillText(tForLanguage('zh-CN', 'entrance'), width - 30, 39, 48)
    g.font = '10px Arial, sans-serif'
    g.fillText(t('printed_entrance'), width - 30, 62, 48)
  } else {
    g.font = 'bold 25px "Microsoft YaHei", sans-serif'
    g.fillText(label, width - 61, 48, 106)
  }
  return c
}

/** Shenzhen's navy fascia: white emblem, exit letter, rail pictogram and line badges. */
function drawShenzhenHeader(g: CanvasRenderingContext2D, stationName: string, exitName: string, english: string, width: number, data: Partial<Pick<StationData, 'cityStyle' | 'lines'>>): void {
  g.fillStyle = cityStyleFor(data.cityStyle).entranceColour
  g.fillRect(0, 0, width, 96)
  drawMetroMark(g, 31, 48, 48, '#ffffff', data.cityStyle)
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'center'
  const label = (exitName || tForLanguage('zh-CN', 'entrance')).trim()
  const identifier = label.match(/^([A-Za-z]\d*)(?:入口|出口|口)?$/)?.[1]
  g.font = 'bold 54px Arial, sans-serif'
  g.fillText(identifier?.toUpperCase() || label, 91, 49, 62)
  // Framed rail pictogram, kept white like the reference fascia.
  g.strokeStyle = '#ffffff'; g.lineWidth = 2
  g.beginPath(); g.roundRect(137, 25, 41, 46, 4); g.stroke()
  g.beginPath(); g.roundRect(145, 33, 25, 28, 7); g.stroke()
  g.fillRect(149, 38, 17, 10)
  for (const x of [150, 165]) { g.beginPath(); g.arc(x, 55, 2, 0, Math.PI * 2); g.fill() }
  g.beginPath(); g.moveTo(151, 61); g.lineTo(146, 67); g.moveTo(164, 61); g.lineTo(169, 67); g.stroke()

  const lines = data.lines?.slice(0, 3) ?? []
  const badgeWidth = 68, badgeGap = 5
  const badgesLeft = width - 14 - lines.length * (badgeWidth + badgeGap) + (lines.length ? badgeGap : 0)
  const stationLeft = 192, stationRight = badgesLeft - 12
  const centre = (stationLeft + stationRight) / 2
  const room = Math.max(32, stationRight - stationLeft)
  const station = (stationName || tForLanguage('zh-CN', 'metro')).trim()
  const name = station.endsWith(tForLanguage('zh-CN', 'station')) ? station : tForLanguage('zh-CN', 'value_station', station)
  g.font = 'bold 28px "Microsoft YaHei", sans-serif'
  g.fillText(name, centre, english.trim() ? 36 : 48, room)
  if (english.trim()) {
    g.font = 'bold 16px Arial, sans-serif'
    g.fillText(english.trim(), centre, 64, room)
  }
  lines.forEach((line, i) => {
    const x = badgesLeft + i * (badgeWidth + badgeGap)
    g.fillStyle = line.colour
    g.beginPath(); g.roundRect(x, 23, badgeWidth, 50, 4); g.fill()
    g.strokeStyle = '#ffffff'; g.lineWidth = 1
    g.beginPath(); g.roundRect(x, 23, badgeWidth, 50, 4); g.stroke()
    g.fillStyle = '#ffffff'; g.font = '38px Arial, sans-serif'
    g.fillText(line.id, x + 19, 48, 31)
    g.font = '14px "Microsoft YaHei", sans-serif'
    g.fillText(t('printed_line_suffix'), x + 49, 43, 29)
    g.font = '9px Arial, sans-serif'
    g.fillText(t('printed_line_value', line.id), x + 49, 59, 30)
  })
}

/* ------------------------------------------------------------------ exit */

/**
 * A blue canopy with a gentle wave along the run: a strip of thin slabs whose
 * heights follow `heightAt`, each tilted to meet its neighbour, so the folded
 * surface reads as the reference art's waved roof. `heightAt(t)` maps 0 at the
 * mouth (−y, over the runs) to 1 at the street doorway (+y); the shared profile
 * is what lets the side glass follow the same edge with no gap. Built flat in
 * the exit's local frame (before the placement rotation), `cx` the plan centre.
 */
function buildWavyRoof(
  g: THREE.Group,
  mat: THREE.Material,
  cx: number,
  y0: number,
  y1: number,
  w: number,
  n: number,
  heightAt: (t: number) => number,
): void {
  const step = (y1 - y0) / n
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * step
    const za = heightAt(i / n)
    const zb = heightAt((i + 1) / n)
    const seg = slab(g, mat, cx, ya + step / 2, (za + zb) / 2, w, Math.hypot(step, zb - za) + 0.03, 0.1)
    seg.name = 'exit-canopy-segment'
    seg.userData.coherentModelDetail = true
    // Tilt the segment so its long (y) axis follows the slope between crests.
    seg.rotation.x = Math.atan2(zb - za, step)
    if (i === 0) {
      const quads = [0, 1].map(j => {
        const a = y0 + j * (y1 - y0) / 2, b = y0 + (j + 1) * (y1 - y0) / 2
        return [new THREE.Vector3(cx - w / 2, a, heightAt(j / 2)), new THREE.Vector3(cx + w / 2, a, heightAt(j / 2)), new THREE.Vector3(cx + w / 2, b, heightAt((j + 1) / 2)), new THREE.Vector3(cx - w / 2, b, heightAt((j + 1) / 2))]
      })
      panelStripModelDetail(seg, quads)
    } else omitModelDetail(seg)
  }
}

/** Merge only touching, coplanar rectangular pad tops. Different widths and
 * heights keep their own surfaces, so a stair/escalator wellway stays open.
 */
function coalesceExitFloorDetail(pads: readonly THREE.Mesh[]): void {
  const rectangles = pads.map(mesh => {
    mesh.updateMatrix(); mesh.geometry.computeBoundingBox()
    return { mesh, box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix) }
  })
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const a = rectangles[i], b = rectangles[j]
    if (a.mesh.material !== b.mesh.material || !close(a.box.max.z, b.box.max.z)) continue
    const alongY = close(a.box.min.x, b.box.min.x) && close(a.box.max.x, b.box.max.x) && Math.min(a.box.max.y, b.box.max.y) >= Math.max(a.box.min.y, b.box.min.y) - 1e-6
    const alongX = close(a.box.min.y, b.box.min.y) && close(a.box.max.y, b.box.max.y) && Math.min(a.box.max.x, b.box.max.x) >= Math.max(a.box.min.x, b.box.min.x) - 1e-6
    if (!alongX && !alongY) continue
    a.box.union(b.box)
    const width = a.box.max.x - a.box.min.x, depth = a.box.max.y - a.box.min.y
    const geometry = new THREE.PlaneGeometry(width, depth)
    const uv = geometry.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * width, uv.getY(k) * depth)
    geometry.translate((a.box.min.x + a.box.max.x) / 2 - a.mesh.position.x, (a.box.min.y + a.box.max.y) / 2 - a.mesh.position.y, a.box.max.z - a.mesh.position.z)
    setModelDetail(a.mesh, geometry); omitModelDetail(b.mesh, true)
    rectangles.splice(j, 1); j = i // rescan the expanded rectangle
  }
}

/**
 * Street exit portal (出入口): a head-house over one, two or three escalator
 * bays, not a square pavilion. The +y end is the street doorway under the metro
 * header; the −y end is the mouth, where the runs pass beneath the long canopy
 * and drop away through an opening in the plaza. The reference art is a red
 * steel portal frame wrapping a blue waved roof over glazed sides and back.
 *
 * 有盖 (covered, the default) draws the canopy, frame and glass; 无盖 (open)
 * drops the roof and walls and runs a railing where each wall stood, so the
 * sim barrier is identical and only the look changes. The bay count widens the
 * floor, frame and glass, and the run openings and interior dividers follow the
 * runs actually placed (`exitRunOpenings`), so two runs descend side by side
 * under one roof.
 *
 * The house is built around the bay group (`exitSpan`): one full block of
 * floor at each end, so a 单向 is 3 blocks across, a 双向 4 and a 三向 5. Its
 * centre — `xc` — is the middle of that plan, which for an even width falls on a
 * cell boundary.
 */
function buildExit(ctx: ModuleContext, mod: Extract<Module, { type: 'exit' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const { centre: xc, half: hw } = exitSpan(mod)
  const W = hw * 2 // across the run group plus its side blocks
  const L = EXIT_L // enclosed part: local y ∈ [−2, +2]
  const H = EXIT_H // canopy height above the walk
  const REACH = EXIT_REACH // how far the canopy reaches over the escalator run (−y)
  const BACK = EXIT_BACK // canopy overhang past the street doorway (+y)
  const hl = L / 2
  const covered = mod.cfg.covered !== false
  const shenzhen = cityStyleFor(ctx.data.cityStyle).entrance === 'shenzhen'
  if (covered) g.userData.exitCityStyle = shenzhen ? 'shenzhen' : 'guangzhou'
  const side = hw - 0.06 // the glass line, just inside the frame
  const BACKY = EXIT_BACK_Y // back wall, just past where the runs go under the floor
  const runs = exitRunOpenings(modelNeighbours(ctx, 'stair', 'escalator', 'walkway'), mod)

  // Head-house floor: a raised concrete plinth over the whole plan the exit claims, so no
  // hollow cell shows between the railings. It runs from one full block before
  // the first run to one full block past the last, and the plaza floor never
  // shows through it. Only a column a run actually descends through is left
  // open, including the terminal track; the mouth-most row remains solid under
  // the back rail. Stairs receive a concrete top landing; escalators own their deck.
  const padLo = xc - hw
  const padHi = xc + hw
  const yHi = Math.ceil(EXIT_BACK + 0.5) - 0.5 // cell-aligned street edge
  // Older saves can have the exit anchor one row away from a stair's upper cell.
  // Carry the wellway through that cell instead of leaving its floor cut beside it.
  const landingBack = exitLandingBack(runs, yHi - 0.3)
  const corridorBack = BACKY + 1 // the mouth-most cell stays floored under the rail
  const concrete = ctx.finish('floor.concrete')
  const pads: THREE.Mesh[] = []
  const pad = (x: number, y: number, w: number, len: number, height = EXIT_BASE_HEIGHT): void => {
    const mesh = finishSlab(g, concrete, x, y, height / 2, w, len, height)
    mesh.name = 'exit-concrete-base'
    pads.push(mesh)
    surfaceModelDetail(mesh, 'z', 1)
  }
  // Two 125 mm risers fit inside the street-edge cell, like a stair block.
  const stepDepth = 0.3
  const upperEdge = yHi - stepDepth
  pad(xc, (landingBack + upperEdge) / 2, W, upperEdge - landingBack)
  pad(xc, yHi - stepDepth / 2, W, stepDepth, EXIT_BASE_HEIGHT / 2)
  // The mouth-most row, solid full width so the back rail sits on the pad.
  pad(xc, (BACKY + corridorBack) / 2, W, corridorBack - BACKY)
  // The descending corridor between them opens only at a run column.
  const stripLen = landingBack - corridorBack
  const stripY = (landingBack + corridorBack) / 2
  const strip = (cx: number, w: number): void => {
    if (w > 0.02) pad(cx, stripY, w, stripLen)
  }
  // The columns runs actually land in (`exitRunOpenings`) and the width each one
  // needs. A run fits its own block, so the floor keeps a full block beside it —
  // the concrete pad on each side covers the whole cell.
  let prev = padLo
  for (const run of runs) {
    // A run descends here: leave a handrail-clear opening, or the balustrade
    // surfaces through the strips beside it.
    strip((prev + (run.column - run.half)) / 2, run.column - run.half - prev)
    prev = Math.max(prev, run.column + run.half)
  }
  strip((prev + padHi) / 2, padHi - prev)
  for (const run of runs) {
    const hasEscalator = modelNeighbours(ctx, 'escalator').some((m) => {
      if (m.type !== 'escalator') return false
      return exitRunOpenings([m], mod).some((r) => r.column === run.column && r.row === run.row)
    })
    if (!hasEscalator) pad(run.column, run.row, run.half * 2, 1)
  }

  if (!covered) coalesceExitFloorDetail(pads)
  const house = new THREE.Group()
  house.position.z = EXIT_BASE_HEIGHT
  g.add(house)

  /**
   * The interior dividers a head-house rails for itself: the midpoint between
   * two runs with an empty block between them. Runs standing side by side share
   * the two balustrades their own models already draw on the boundary, so nothing
   * is drawn between those two — a rail there would cut through both of them.
   */
  const dividers: number[] = []
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i]
    const b = runs[i + 1]
    if (b.column - a.column >= 2) dividers.push((a.column + b.column) / 2)
  }

  // 无盖 railing: the 围栏 glass panel, not a bare steel rail — a steel top and
  // bottom rail with a glass sheet between them and a post at each joint. Built
  // along a fixed local x (railZ) or y (railX), so it reads as the same fence
  // piece the player places by hand.
  const lowPosts = new Set<string>()
  const post = (x: number, y: number, keep: boolean): void => {
    omitModelDetail(slab(house, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04))
    const upright = slab(house, mats.steel, x, y, 0.5, 0.08, 0.08, 1.0)
    const key = `${x.toFixed(5)},${y.toFixed(5)}`
    if (!keep || lowPosts.has(key)) omitModelDetail(upright)
    else { lowPosts.add(key); tubeModelDetail(upright) }
  }
  const railZ = (cx: number, y0: number, y1: number): void => {
    const len = y1 - y0
    const cy = (y0 + y1) / 2
    panelModelDetail(slab(house, mats.steel, cx, cy, 0.955, 0.07, len, 0.09), 'z')
    omitModelDetail(slab(house, mats.steel, cx, cy, 0.06, 0.07, len, 0.08))
    panelModelDetail(slab(house, mats.glass, cx, cy, 0.52, 0.03, len, 0.76), 'x')
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(cx, y0 + (len * i) / n, i === 0 || i === n)
  }
  const railX = (cy: number, x0: number, x1: number): void => {
    const len = x1 - x0
    const cx = (x0 + x1) / 2
    panelModelDetail(slab(house, mats.steel, cx, cy, 0.955, len, 0.07, 0.09), 'z')
    omitModelDetail(slab(house, mats.steel, cx, cy, 0.06, len, 0.07, 0.08))
    panelModelDetail(slab(house, mats.glass, cx, cy, 0.52, len, 0.03, 0.76))
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(x0 + (len * i) / n, cy, i === 0 || i === n)
  }

  // The canopy profile, shared by the roof, the glazing and the sign: it rises
  // toward the street doorway (+y), so the sign side stands tallest.
  const FLOOR_TOP = 0.3
  const ry0 = -REACH
  const ry1 = BACK
  const waveAmp = 0.16
  const periods = 0.85
  const heightAt = (t: number): number => shenzhen ? H : H + 0.4 * (t - 0.5) - waveAmp * Math.sin(t * Math.PI * 2 * periods)
  const topAt = (y: number): number => heightAt((y - ry0) / (ry1 - ry0))

  if (covered && shenzhen) {
    buildShenzhenCanopy(house, ctx, xc, W)
    for (const cx of dividers) {
      slab(house, mats.steel, cx, -1.0, .95, .06, 2, .06)
      for (const y of [-1.8,-.2]) slab(house, mats.steel, cx, y, .5, .06, .06, .9)
    }
  } else if (covered) {
    // The reference head-house is a red steel frame, not a row of pillars: on
    // each side a post runs up to a top beam that wraps over the blue canopy,
    // the frames are tied at the base by red steel parallel to the ground, and
    // the glass hangs inside. Because it is all glass, the back is a glazed
    // wall too; the roof rises toward the street doorway (+y) so the sign side
    // stands tallest, and the side glass follows the wave with no gap.
    const frameX = side + 0.03 // posts just outside the glass
    const frameTop = H + 0.55 // top beam, just clear of the wave crest
    const frameYs = [BACKY + 0.3, (BACKY + EXIT_GLASS_Y1) / 2, EXIT_GLASS_Y1 - 0.15]
    for (const fy of frameYs) {
      for (const sx of [-1, 1]) {
        const upright = slab(house, mats.exitRed, xc + sx * frameX, fy, frameTop / 2, 0.16, 0.16, frameTop)
        if (fy === frameYs[1]) omitModelDetail(upright)
        else tubeModelDetail(upright)
      }
      const beam = slab(house, mats.exitRed, xc, fy, frameTop - 0.08, frameX * 2 + 0.16, 0.16, 0.16)
      if (fy === frameYs[1]) omitModelDetail(beam)
      else tubeModelDetail(beam)
    }
    // Base frame: side members along the run plus the far cross tie only — the
    // street doorway stays clear, so no red beam runs across the entrance floor.
    const baseY0 = frameYs[0]
    const baseY1 = frameYs[frameYs.length - 1]
    for (const sx of [-1, 1]) omitModelDetail(slab(house, mats.exitRed, xc + sx * frameX, (baseY0 + baseY1) / 2, 0.2, 0.14, baseY1 - baseY0 + 0.3, 0.2))
    omitModelDetail(slab(house, mats.exitRed, xc, baseY0, 0.2, frameX * 2, 0.14, 0.2))

    // Blue waved canopy, rising toward the street doorway (+y). `heightAt` is
    // the profile the roof, the glazing and the sign share, so the glass meets
    // the roof edge with no gap and the sign hangs off the roof itself.
    // The canopy overhangs the frame, but never past the plan the exit claims
    // (a 单向 is only three blocks, so its roof is trimmed to the floor edge).
    const roofW = Math.min(frameX * 2 + 0.6, W)
    buildWavyRoof(house, mats.blue, xc, ry0, ry1, roofW, 22, heightAt)

    // Glass sides, each panel tilted to follow the roof, top edge tucked into it.
    const sideGlass = (x: number): void => {
      const n = 16
      const step = (EXIT_GLASS_Y1 - EXIT_GLASS_Y0) / n
      for (let i = 0; i < n; i++) {
        const ya = EXIT_GLASS_Y0 + i * step
        const yb = ya + step
        const za = topAt(ya)
        const zb = topAt(yb)
        const theta = Math.atan2(zb - za, step)
        const zmid = (za + zb) / 2
        const h = (zmid - FLOOR_TOP) / Math.cos(theta)
        const panel = slab(house, mats.glass, x, (ya + yb) / 2, (zmid + FLOOR_TOP) / 2, 0.04, Math.hypot(step, zb - za), h)
        panel.name = 'exit-side-glass'
        panel.userData.coherentModelDetail = true
        panel.rotation.x = theta
        if (i === 0) {
          const lowAt = (y: number) => {
            const t = THREE.MathUtils.clamp((y - ry0) / (ry1 - ry0), 0, 1)
            const start = t < .5 ? 0 : .5
            return THREE.MathUtils.lerp(heightAt(start), heightAt(start + .5), (t - start) * 2)
          }
          const cuts = [EXIT_GLASS_Y0, (ry0 + ry1) / 2, EXIT_GLASS_Y1].filter((y, j) => j !== 1 || y > EXIT_GLASS_Y0 && y < EXIT_GLASS_Y1)
          const quads = cuts.slice(1).map((b, j) => {
            const a = cuts[j]
            return [new THREE.Vector3(x, a, FLOOR_TOP), new THREE.Vector3(x, b, FLOOR_TOP), new THREE.Vector3(x, b, lowAt(b)), new THREE.Vector3(x, a, lowAt(a))]
          })
          panelStripModelDetail(panel, quads)
        } else omitModelDetail(panel)
      }
    }
    for (const sx of [-1, 1]) sideGlass(xc + sx * side)
    // Glass back wall (glazed like the sides); its head follows the roof there.
    const zBack = topAt(BACKY)
    panelModelDetail(slab(house, mats.glass, xc, BACKY, (zBack + FLOOR_TOP) / 2, side * 2, 0.05, zBack - FLOOR_TOP))

    // Under-canopy light strips down the middle, tucked under the wave.
    for (let i = 0; i < 3; i++) {
      const ly = 1.2 - i * 2.0
      omitModelDetail(slab(house, mats.glow, xc, ly, topAt(ly) - 0.1, 0.16, 0.9, 0.04))
    }

    // Handrail down each divider between two runs.
    for (const cx of dividers) {
      slab(house, mats.steel, cx, -1.0, 0.95, 0.06, 2.0, 0.06)
      for (const s of [-1, 1]) for (let j = 0; j <= 1; j++) slab(house, mats.steel, cx, s * (0.2 + j * 1.6), 0.5, 0.06, 0.06, 0.9)
    }
  } else {
    // 无盖: no canopy, frame or walls — a railing stands where each wall was, all
    // the way along the sides and across the back, plus each divider between runs.
    for (const sx of [-1, 1]) railZ(xc + sx * side, EXIT_GLASS_Y0, EXIT_GLASS_Y1)
    railX(BACKY, xc - side, xc + side)
    for (const cx of dividers) railZ(cx, BACKY, EXIT_GLASS_Y1)
  }

  // The exit's own name (A口 / 北门) prints on the header board, so renaming it in
  // the inspector updates the model.
  //
  // 有盖 hangs the board off the canopy at the street doorway: its top edge meets
  // the roof underside, so the sign reads as part of the head-house rather than
  // floating on a frame. 无盖 has no roof — and nothing to hang from — so the board
  // is fixed over the *mouth* railing instead: it lies over that fence's glass and
  // faces back up the runs, toward the wellway the crowd descends, so the railing
  // carries it and it needs no posts of its own. Both read from the same side
  // (+y, the head-house's own length), which is where a passenger stands.
  const signBoard = 0.62
  const signY = covered ? hl - 0.02 : BACKY
  const signZ = covered ? topAt(hl + 0.06) - signBoard / 2 - 0.02 : 0.52
  panelModelDetail(slab(house, mats.darkSteel, xc, signY, signZ, W - 0.06, 0.12, signBoard))
  const header = plate(house, ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || tForLanguage('zh-CN', 'metro'), mod.cfg.name || t('entrances'), ctx.data.nameEn, 512, ctx.data), 0, 0)) })), W - .3, 0.5, xc, signY + 0.08, signZ, Math.PI)
  bindArtworkTexture(house, (header.material as THREE.MeshBasicMaterial).map!, (c, data) => {
    const next = data.modules.find(m => m.id === mod.id)
    c.drawImage(exitHeaderCanvas(data.name || tForLanguage('zh-CN', 'metro'), next?.type === 'exit' ? next.cfg.name || t('entrances') : mod.cfg.name, data.nameEn, 512, data),0,0)
  })
  header.renderOrder = 1
  return g
}

export class ExitModel extends PieceBuilder {
  readonly kind = 'exit'
  build(mod: Extract<Module, { type: 'exit' }>): THREE.Group {
    if (mod.cfg.style === 'doorway') return new DoorwayExitModel(this.ctx).build(mod)
    if (mod.cfg.style === 'virtual') {
      // 虚拟 exit reuses the 导向柱 pillar: a 1×1 surface exit whose letter reads
      // from its own exit name. The synthetic guidepost links back to this exit
      // id so `guideLabels` resolves the same station + exit copy.
      const root = new GuidepostModel(this.ctx).build({ ...mod, type: 'guidepost', cfg: { exitId: mod.id } })
      for (const child of root.children) {
        if (!(child instanceof THREE.Mesh)) continue
        if (child.name === 'guide-triangular-base') omitModelDetail(child)
        else if (child.geometry.type === 'ExtrudeGeometry') {
          // Adjacent column sections cover the two triangular end caps.
          const simple = child.geometry.clone()
          simple.setIndex(Array.from({ length: simple.attributes.position.count - 6 }, (_, i) => i + 6))
          simple.clearGroups(); setModelDetail(child, simple)
        }
      }
      return root
    }
    return placeLocal(buildExit(this.ctx, mod), mod)
  }
}

import { bindArtworkTexture } from '../../artwork.ts'
