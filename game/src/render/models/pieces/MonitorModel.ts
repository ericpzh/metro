import * as THREE from 'three'
import { planarArtworkDetail } from '../../planarArtworkDetail.ts'
import { omitModelDetail, tubeModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, ownedMaterial, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { hangCeilingLocal } from '../../../sim/placement.ts'
import { rotateLocal } from '../../../sim/track.ts'

/** The cabinet's centre, in metres, below the surface a ceiling-mounted 显示器 hangs from. */
const MONITOR_HANG = 0.9

/** Decorative platform views, drawn as flat ink so they need no extra scene cameras. */
export class MonitorModel extends PieceBuilder {
  readonly kind = 'monitor'
  build(mod: Extract<Module, { type: 'monitor' }>): THREE.Group {
    const g = new THREE.Group()
    const wall = mod.cfg.mount === 'wall'
    const width = wall ? 3 : 0.96
    const height = wall ? 2 : 0.72
    // The **ceiling** cabinet rides just under the surface it hangs from (`hangCeilingLocal`): the
    // slab over its cell, or the line the player aimed at — its own 0.9 m of rod. The **wall** one
    // is bolted at eye height, exactly as it always was.
    const ceiling = hangCeilingLocal(mod, this.ctx.data.cells, this.ctx.data.modules)
    const z = wall ? 1.5 : ceiling - MONITOR_HANG
    const y = wall ? -0.40 : 0
    const mats = this.ctx.mats
    slab(g, mats.darkSteel, 0, y, z, width, 0.18, height)
    if (!wall) {
      for (const x of [-0.30, 0.30]) {
        const top = z + height / 2
        tubeModelDetail(slab(g, mats.steel, x, y, (top + ceiling) / 2, 0.035, 0.035, ceiling - top))
        omitModelDetail(slab(g, mats.darkSteel, x, y, ceiling - 0.02, 0.12, 0.12, 0.04))
      }
    }
    const ink = (colour: number, depthWrite = false) => ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ color: colour, depthWrite }))
    const screenBg = ink(0x080c12, true), floor = ink(0xb9cbca), track = ink(0x354950), rail = ink(0x8bd4dc)
    const wallInk = ink(0x729994), passenger = ink(0x415666)
    const count = wall ? 3 : 1
    const rows = wall ? 4 : 1
    const paneW = wall ? 1 : width - 0.16
    const paneH = wall ? 0.5 : height - 0.18
    for (let i = 0; i < count * rows; i++) {
      const x = wall ? -width / 2 + 0.5 + (i % count) : 0
      const screenZ = wall ? z + height / 2 - 0.25 - Math.floor(i / count) * 0.5 : z
      const view = new THREE.Group()
      view.name = `monitor-view-${i}`
      // Screen planes stand clear of the housing; local -y is the viewing face.
      plate(view, wall ? screenBg : floor, paneW, paneH, x, y - 0.095, screenZ, 0)
      let inkLayer = 0
      // Keep all flat graphics on one plane, but draw them in a stable order
      // without depth writes. Nested dashboard layers used to z-fight in perspective.
      const inkOrder = (_hint: number) => ++inkLayer
      const polygon = (material: THREE.Material, points: number[][], depth: number) => {
        const shape = new THREE.Shape()
        points.forEach(([px, pz], j) => j ? shape.lineTo(px! * paneW, pz! * paneH) : shape.moveTo(px! * paneW, pz! * paneH))
        shape.closePath()
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material)
        mesh.rotation.x = Math.PI / 2
        mesh.position.set(x, y - 0.105, screenZ)
        mesh.renderOrder = inkOrder(depth)
        view.add(mesh)
      }
      const bar = (material: THREE.Material, cx: number, cz: number, w: number, h: number, depth = 0.099) => {
        const shape = plate(view, material, w * paneW, h * paneH, x + cx * paneW, y - 0.105, screenZ + cz * paneH, 0)
        shape.renderOrder = inkOrder(depth)
      }
      const trackScene = (flip: number) => {
        polygon(track, [[flip * 0.05, -0.5], [flip * 0.5, -0.5], [flip * 0.15, 0.5], [flip * 0.06, 0.5]], 0.097)
        for (const offset of [0.08, 0.29]) polygon(rail, [[flip * offset, -0.5], [flip * (offset + 0.015), -0.5], [flip * (0.075 + offset * 0.16), 0.5], [flip * (0.07 + offset * 0.16), 0.5]], 0.099)
        polygon(wallInk, [[-flip * 0.5, -0.5], [-flip * 0.40, -0.5], [-flip * 0.05, 0.5], [-flip * 0.5, 0.5]], 0.098)
      }
      // Each half-metre panel carries a different dashboard/feed layout, rather
      // than repeating the same station illustration across the whole cabinet.
      switch (i) {
        case 0: trackScene(1); break
        case 1: trackScene(-1); bar(rail, -0.25, 0.25, 0.16, 0.12); bar(wallInk, 0.23, -0.26, 0.12, 0.1); break
        case 2: // route map
          polygon(rail, [[-0.45, 0.22], [-0.28, 0.22], [-0.08, -0.18], [0.12, -0.18], [0.3, 0.22], [0.46, 0.22], [0.46, 0.31], [0.24, 0.31], [0.06, -0.08], [-0.14, -0.08], [-0.34, 0.31], [-0.45, 0.31]], 0.098)
          for (const cx of [-0.32, -0.1, 0.1, 0.3]) bar(floor, cx, 0.265, 0.08, 0.2)
          bar(wallInk, 0, -0.32, 0.72, 0.08); break
        case 3: // CCTV frame and subject
          bar(wallInk, 0, 0, 0.88, 0.9)
          bar(track, 0, 0, 0.78, 0.78)
          bar(floor, 0, 0, 0.68, 0.62)
          polygon(passenger, [[-0.12, -0.1], [-0.03, -0.1], [-0.03, 0.17], [-0.12, 0.17]], 0.101)
          bar(passenger, -0.075, 0.22, 0.13, 0.18, 0.102)
          for (const [cx, cz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) bar(rail, cx!, cz!, 0.12, 0.08, 0.103)
          break
        case 4: // passenger count chart
          bar(track, 0, -0.35, 0.78, 0.06)
          for (let n = 0; n < 5; n++) bar([rail, wallInk, passenger, rail, wallInk][n]!, -0.32 + n * 0.16, -0.12 + (n % 3) * 0.08, 0.09, 0.36 + (n % 3) * 0.12)
          break
        case 5: // timetable rows
          bar(wallInk, 0, 0.34, 0.78, 0.16)
          for (let n = 0; n < 4; n++) { bar(n % 2 ? floor : track, 0, 0.12 - n * 0.17, 0.78, 0.09); bar(rail, -0.26, 0.12 - n * 0.17, 0.14 + (n % 2) * 0.08, 0.035) }
          break
        case 6: // train profile
          bar(wallInk, 0, 0, 0.88, 0.72)
          bar(floor, 0, -0.22, 0.78, 0.14)
          bar(rail, 0, 0.05, 0.68, 0.34)
          bar(track, 0, 0.05, 0.56, 0.22)
          for (const cx of [-0.2, 0, 0.2]) bar(floor, cx, 0.08, 0.14, 0.16)
          break
        case 7: // signal status columns
          for (let n = 0; n < 4; n++) { bar(track, -0.3 + n * 0.2, 0, 0.13, 0.68); bar([rail, wallInk, passenger, rail][n]!, -0.3 + n * 0.2, 0.22 - (n % 2) * 0.16, 0.09, 0.13) }
          break
        case 8: // crowd density camera
          bar(floor, 0, 0, 0.88, 0.88)
          for (let n = 0; n < 6; n++) { const cx = -0.34 + (n % 3) * 0.34; const cz = 0.22 - Math.floor(n / 3) * 0.42; bar(passenger, cx, cz, 0.11, 0.3); bar(wallInk, cx, cz + 0.23, 0.13, 0.13) }
          break
        case 9: // warning / incident panel
          bar(track, 0, 0, 0.88, 0.88)
          polygon(rail, [[0, 0.42], [0.4, -0.32], [-0.4, -0.32]], 0.101)
          bar(track, 0, 0.03, 0.055, 0.38, 0.103)
          bar(track, 0, -0.24, 0.08, 0.08, 0.103)
          break
        case 10: // live service waveform
          bar(track, 0, 0, 0.88, 0.88)
          polygon(rail, [[-0.44, 0], [-0.3, 0], [-0.22, 0.34], [-0.12, -0.3], [-0.02, 0.1], [0.08, 0], [0.18, 0.26], [0.27, -0.2], [0.35, 0], [0.44, 0]], 0.101)
          bar(wallInk, 0, -0.36, 0.7, 0.06)
          break
        default: // tiled operations dashboard
          for (let n = 0; n < 4; n++) { const cx = n % 2 ? 0.22 : -0.22; const cz = n < 2 ? 0.22 : -0.22; bar([wallInk, rail, passenger, track][n]!, cx, cz, 0.34, 0.32); bar(floor, cx, cz + 0.03, 0.19 + (n % 2) * 0.06, 0.06) }
      }
      if (wall) {
        // The wall is local -y. Turn the ink toward the room, retaining the wall anchor.
        view.rotation.z = Math.PI
        view.position.y = 2 * y
      }
      g.add(view)
    }
    plate(g, mats.ledGreen, 0.025, 0.015, width / 2 - 0.05, y + (wall ? 0.095 : -0.095), z - height / 2 + 0.04, wall ? Math.PI : 0)
    const views = g.children.filter(child => child.name.startsWith('monitor-view-'))
    planarArtworkDetail(g, views, width, height, y + (wall ? .107 : -.107), z, wall, mat => ownedMaterial(this.ctx, mat))
    placeLocal(g, mod)
    const [dx, dy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
    g.position.x += dx
    g.position.y += dy
    return g
  }
}
