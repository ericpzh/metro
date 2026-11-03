import * as THREE from 'three'
import { plate } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'

// Preserve depth and height; compress the cross-pillar width to a 30-degree nose.
export const GUIDE_WIDTH_SCALE = (.11547 + .23094) * Math.tan(Math.PI / 12) / .2
export const GUIDE_RED_SCALE = .75
export const GUIDE_PLAN: ReadonlyArray<readonly [number, number]> = [[-.2 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .11547 * GUIDE_RED_SCALE], [0, -.23094 * GUIDE_RED_SCALE], [.2 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .11547 * GUIDE_RED_SCALE]]
export const GUIDE_MIDDLE_PLAN: ReadonlyArray<readonly [number,number]> = [[-.17 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .07 * GUIDE_RED_SCALE], GUIDE_PLAN[1], [.17 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .07 * GUIDE_RED_SCALE]]
// Same heading as the red triangle: a narrower back edge sits forward of it,
// while the longer nose projects beyond it and changes the side-face angles.
export const GUIDE_YELLOW_PLAN: ReadonlyArray<readonly [number, number]> = [[-.17 * GUIDE_WIDTH_SCALE, .07], [0, -.49], [.17 * GUIDE_WIDTH_SCALE, .07]]
export const GUIDE_LOGO_BOTTOM = 3.02
export const GUIDE_LOGO_TOP = 3.46

export function triangleColumn(material: THREE.Material, height: number, scale = 1, plan = GUIDE_PLAN): THREE.Mesh {
  const shape = new THREE.Shape()
  plan.forEach(([x, y], i) => i === 0 ? shape.moveTo(x * scale, y * scale) : shape.lineTo(x * scale, y * scale))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  const mesh = new THREE.Mesh(geometry, material)
  // The foot sits on the ground; each upper prism sits on the preceding section.
  const low = geometry.clone(), indices: number[] = []
  for (let i = 0; i < geometry.attributes.position.count; i += 3) {
    if (geometry.attributes.normal.getZ(i) > -.9) indices.push(i, i + 1, i + 2)
  }
  low.setIndex(indices); low.clearGroups()
  if (height > .07) setModelDetail(mesh, low)
  else low.dispose()
  return mesh
}

/** Attach one panel to each of the three prism faces, using the actual edge normal. */
export function threeFaces(group: THREE.Group, scale: number, mat: THREE.Material | readonly THREE.Material[], bottom: number, top: number, name: string, plan = GUIDE_PLAN, squareSize?: number): void {
  for (let i = 0; i < 3; i++) {
    const a = plan[i], b = plan[(i + 1) % 3]
    const x = (a[0] + b[0]) * scale / 2, y = (a[1] + b[1]) * scale / 2
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length = Math.hypot(dx, dy), nx = dy / length, ny = -dx / length
    const width = squareSize === undefined ? length * scale : Math.min(squareSize, length * scale * .7)
    const height = squareSize === undefined ? top - bottom : width
    const face = plate(group, mat instanceof THREE.Material ? mat : mat[i], width, height, x + nx * .001, y + ny * .001, (top + bottom) / 2, Math.atan2(nx, -ny))
    face.name = name
  }
}

