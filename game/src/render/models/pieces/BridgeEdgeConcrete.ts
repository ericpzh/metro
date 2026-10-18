import * as THREE from 'three'
import { finishSlab } from '../PieceBuilder.ts'

/** Raise the deck shoulders to the barrier/railing footing (§5.4). */
export function buildBridgeEdgeConcrete(g: THREE.Group, material: THREE.Material, width: number, y: number, depth: number, top: number, postXs: readonly number[], bottom = 0): void {
  const end = width - 0.5
  const section = (start: number, finish: number): void => {
    if (finish <= start) return
    finishSlab(g, material, (start + finish) / 2, y, (top + bottom) / 2, finish - start, depth, top - bottom).name = 'bridge-edge-concrete'
  }
  let start = -0.5
  // Keep the exposed concrete faces out of the gantry steel, including posts
  // belonging to a neighbouring platform that straddle the module seam.
  for (const x of [...postXs].sort((a, b) => a - b)) {
    if (x + 0.06 <= start || x - 0.06 >= end) continue
    section(start, Math.min(end, x - 0.06))
    start = Math.min(end, Math.max(start, x + 0.06))
  }
  section(start, end)
}
