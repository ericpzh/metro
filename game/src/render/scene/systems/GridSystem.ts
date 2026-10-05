// GridSystem — the editing grid and the placement cursor (moved verbatim from
// `render/scene.ts`: `clearGrid`, `buildGrid`, `setGridVisible`, `setCursor`).
//
// The grid is drawn from the station bounds at the active storey and rebuilt
// only when its extent key moves — most edits rebuild an identical grid, so
// the key check skips the VBO churn.

import * as THREE from 'three'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'

export class GridSystem extends SceneSystem {
  grid: THREE.Group = new THREE.Group()
  /** The extent and storey the drawn grid was built for, so it is only remade when it moves. */
  private gridKey = ''
  cursor: THREE.Mesh

  constructor(ctx: SceneContext) {
    super(ctx)
    this.ctx.scene.add(this.grid)
    // A 1 m square that lines up with the block grid: the 4-segment ring starts
    // at 45° so its corners are the cell corners, and it is never rotated, so it
    // highlights exactly the cell under the pointer at any camera angle.
    const cursorGeo = new THREE.RingGeometry(0.6, Math.SQRT1_2, 4, 1, Math.PI / 4)
    this.cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    this.cursor.visible = false
    this.ctx.scene.add(this.cursor)
  }

  clearGrid(): void {
    // `Group.clear()` only unparents: the geometry and the per-build line material
    // have to be released too, or every rebuild leaves a dead VBO behind.
    for (const child of this.grid.children) {
      const seg = child as THREE.LineSegments
      seg.geometry?.dispose()
      const mat = seg.material as THREE.Material | undefined
      mat?.dispose()
    }
    this.grid.clear()
  }

  buildGrid(): void {
    const box = this.ctx.bounds
    const x0 = Math.floor(box.min.x / 5) * 5 - 5
    const x1 = Math.ceil(box.max.x / 5) * 5 + 5
    const y0 = Math.floor(box.min.y / 5) * 5 - 5
    const y1 = Math.ceil(box.max.y / 5) * 5 + 5
    const z = this.ctx.activeZ + 1.002
    // The grid depends on the station's extent and the active storey, not on what
    // the last edit changed — and `setStation` and `setLevel` both call this, so
    // most edits rebuild an identical grid. Reuse it when nothing it reads moved.
    const key = `${x0},${x1},${y0},${y1},${z}`
    if (key === this.gridKey && this.grid.children.length > 0) return
    this.clearGrid()
    this.gridKey = key
    const minor = new Float32Array(((x1 - x0) + (y1 - y0) + 2) * 6)
    let k = 0
    for (let x = x0; x <= x1; x++) {
      minor[k++] = x; minor[k++] = y0; minor[k++] = z; minor[k++] = x; minor[k++] = y1; minor[k++] = z
    }
    for (let y = y0; y <= y1; y++) {
      minor[k++] = x0; minor[k++] = y; minor[k++] = z; minor[k++] = x1; minor[k++] = y; minor[k++] = z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(minor.subarray(0, k), 3))
    this.grid.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a3444, transparent: true, opacity: 0.8 })))
    void k
  }

  setGridVisible(on: boolean): void {
    this.grid.visible = on
  }

  setCursor(cell: [number, number, number] | null, valid = true): void {
    if (!cell) {
      this.cursor.visible = false
      return
    }
    this.cursor.visible = true
    this.cursor.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 1.02)
    const mat = this.cursor.material as THREE.MeshBasicMaterial
    mat.color.setHex(valid ? 0x6ee7ff : 0xff5d5d)
  }
}
