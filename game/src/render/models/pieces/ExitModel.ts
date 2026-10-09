// Exit portal (出入口) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, finishSlab, canvasTexture, drawMetroMark, slab, plate, ownedMaterial, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, exitRunOpenings, exitSpan } from '../../../sim/exits.ts'
import { EXIT_BASE_HEIGHT } from './ExitLanding.ts'
import { DoorwayExitModel } from './DoorwayExitModel.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * The exit portal header: the metro logo, station name and the exit's name.
 */
export function exitHeaderCanvas(stationName: string, exitName: string, stationNameEn = ''): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#c22f28'
  g.fillRect(0, 0, 512, 96)
  drawMetroMark(g, 34, 48, 46, '#ffffff')
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  g.font = 'bold 19px "Microsoft YaHei", sans-serif'
  g.fillText('广州地铁', 64, 39, 108)
  g.font = '11px Arial, sans-serif'
  g.fillText('Guangzhou Metro', 64, 61, 108)

  // Keep long station names within the centre field, clear of the brand and exit.
  const station = (stationName || '地铁').trim()
  const stationLabel = station.endsWith('站') ? station : station + '站'
  g.textAlign = 'center'
  g.font = 'bold 29px "Microsoft YaHei", sans-serif'
  g.fillText(stationLabel, 280, stationNameEn.trim() ? 36 : 48, 198)
  if (stationNameEn.trim()) {
    g.font = '16px Arial, sans-serif'
    g.fillText(stationNameEn.trim(), 280, 64, 198)
  }

  // Preserve multi-character identifiers such as C1; named exits remain readable.
  const label = (exitName || '入口').trim()
  const identifier = label.match(/^([A-Za-z]\d*)(?:入口|出口|口)?$/)?.[1]
  if (identifier) {
    g.font = 'bold 40px Arial, sans-serif'
    g.fillText(identifier.toUpperCase(), 427, 48, 64)
    g.font = 'bold 21px "Microsoft YaHei", sans-serif'
    g.fillText('入口', 482, 39, 48)
    g.font = '10px Arial, sans-serif'
    g.fillText('Entrance', 482, 62, 48)
  } else {
    g.font = 'bold 25px "Microsoft YaHei", sans-serif'
    g.fillText(label, 451, 48, 106)
  }
  return c
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
    // Tilt the segment so its long (y) axis follows the slope between crests.
    seg.rotation.x = Math.atan2(zb - za, step)
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
  const side = hw - 0.06 // the glass line, just inside the frame
  const BACKY = EXIT_BACK_Y // back wall, just past where the runs go under the floor

  // Head-house floor: a raised concrete plinth over the whole plan the exit claims, so no
  // hollow cell shows between the railings. It runs from one full block before
  // the first run to one full block past the last, and the plaza floor never
  // shows through it. Only a column a run actually descends through is left
  // open, including the terminal track; the mouth-most row remains solid under
  // the back rail. Stairs receive a concrete top landing; escalators own their deck.
  const padLo = xc - hw
  const padHi = xc + hw
  const yHi = Math.ceil(EXIT_BACK + 0.5) - 0.5 // cell-aligned street edge
  const landingBack = 0.5 // street edge of the run's top-landing cell (local y)
  const corridorBack = BACKY + 1 // the mouth-most cell stays floored under the rail
  const concrete = ctx.finish('floor.concrete')
  const pad = (x: number, y: number, w: number, len: number, height = EXIT_BASE_HEIGHT): void => {
    const mesh = finishSlab(g, concrete, x, y, height / 2, w, len, height)
    mesh.name = 'exit-concrete-base'
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
  const runs = exitRunOpenings(ctx.data.modules, mod)
  let prev = padLo
  for (const run of runs) {
    // A run descends here: leave a handrail-clear opening, or the balustrade
    // surfaces through the strips beside it.
    strip((prev + (run.column - run.half)) / 2, run.column - run.half - prev)
    prev = Math.max(prev, run.column + run.half)
  }
  strip((prev + padHi) / 2, padHi - prev)
  for (const run of runs) {
    const hasEscalator = ctx.data.modules.some((m) => {
      if (m.type !== 'escalator') return false
      return exitRunOpenings([m], mod).some((r) => r.column === run.column)
    })
    if (!hasEscalator) pad(run.column, 0, run.half * 2, 1)
  }

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
  const post = (x: number, y: number): void => {
    slab(house, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04)
    slab(house, mats.steel, x, y, 0.5, 0.08, 0.08, 1.0)
  }
  const railZ = (cx: number, y0: number, y1: number): void => {
    const len = y1 - y0
    const cy = (y0 + y1) / 2
    slab(house, mats.steel, cx, cy, 0.955, 0.07, len, 0.09)
    slab(house, mats.steel, cx, cy, 0.06, 0.07, len, 0.08)
    slab(house, mats.glass, cx, cy, 0.52, 0.03, len, 0.76)
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(cx, y0 + (len * i) / n)
  }
  const railX = (cy: number, x0: number, x1: number): void => {
    const len = x1 - x0
    const cx = (x0 + x1) / 2
    slab(house, mats.steel, cx, cy, 0.955, len, 0.07, 0.09)
    slab(house, mats.steel, cx, cy, 0.06, len, 0.07, 0.08)
    slab(house, mats.glass, cx, cy, 0.52, len, 0.03, 0.76)
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(x0 + (len * i) / n, cy)
  }

  // The canopy profile, shared by the roof, the glazing and the sign: it rises
  // toward the street doorway (+y), so the sign side stands tallest.
  const FLOOR_TOP = 0.3
  const ry0 = -REACH
  const ry1 = BACK
  const waveAmp = 0.16
  const periods = 0.85
  const heightAt = (t: number): number => H + 0.4 * (t - 0.5) - waveAmp * Math.sin(t * Math.PI * 2 * periods)
  const topAt = (y: number): number => heightAt((y - ry0) / (ry1 - ry0))

  if (covered) {
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
      for (const sx of [-1, 1]) slab(house, mats.exitRed, xc + sx * frameX, fy, frameTop / 2, 0.16, 0.16, frameTop)
      slab(house, mats.exitRed, xc, fy, frameTop - 0.08, frameX * 2 + 0.16, 0.16, 0.16)
    }
    // Base frame: side members along the run plus the far cross tie only — the
    // street doorway stays clear, so no red beam runs across the entrance floor.
    const baseY0 = frameYs[0]
    const baseY1 = frameYs[frameYs.length - 1]
    for (const sx of [-1, 1]) slab(house, mats.exitRed, xc + sx * frameX, (baseY0 + baseY1) / 2, 0.2, 0.14, baseY1 - baseY0 + 0.3, 0.2)
    slab(house, mats.exitRed, xc, baseY0, 0.2, frameX * 2, 0.14, 0.2)

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
        panel.rotation.x = theta
      }
    }
    for (const sx of [-1, 1]) sideGlass(xc + sx * side)
    // Glass back wall (glazed like the sides); its head follows the roof there.
    const zBack = topAt(BACKY)
    slab(house, mats.glass, xc, BACKY, (zBack + FLOOR_TOP) / 2, side * 2, 0.05, zBack - FLOOR_TOP)

    // Under-canopy light strips down the middle, tucked under the wave.
    for (let i = 0; i < 3; i++) {
      const ly = 1.2 - i * 2.0
      slab(house, mats.glow, xc, ly, topAt(ly) - 0.1, 0.16, 0.9, 0.04)
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
  slab(house, mats.darkSteel, xc, signY, signZ, W - 0.06, 0.12, signBoard)
  const header = plate(house, ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || '地铁', mod.cfg.name || '出入口', ctx.data.nameEn), 0, 0)) })), W - 0.3, 0.5, xc, signY + 0.08, signZ, Math.PI)
  header.renderOrder = 1
  return g
}

export class ExitModel extends PieceBuilder {
  readonly kind = 'exit'
  build(mod: Extract<Module, { type: 'exit' }>): THREE.Group {
    if (mod.cfg.style === 'doorway') return new DoorwayExitModel(this.ctx).build(mod)
    return placeLocal(buildExit(this.ctx, mod), mod)
  }
}

