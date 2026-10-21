import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'
import { trainWindowLow } from './TrainWindowLow.ts'

/** L stock (§1.12): small end panes and wide, paired inter-door windows.
 * Door positions still come from stock.ts so platform alignment is unchanged.
 */
export function buildLWindowBay(g: THREE.Group, mats: ModelMaterials, a: number, b: number,
  y: number, sill: number, head: number, betweenDoors: boolean): void {
  const width = b - a, height = head - sill
  const x = (a + b) / 2, z = (sill + head) / 2
  // At a driving end the shell leaves only a narrow pillar beside the first
  // doorway; CabModel supplies that end's small side pane on the cab itself.
  if (width < 0.6) {
    slab(g, mats.trainBody, x, y, z, width, 0.06, height)
    return
  }
  const windowWidth = betweenDoors ? Math.min(2.65, width - 0.8) : Math.min(0.7, width - 0.4)
  const windowHeight = height - 0.2
  const rounded = (w: number, h: number, r: number) => {
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2 + r, -h / 2)
    shape.lineTo(w / 2 - r, -h / 2)
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
    shape.lineTo(w / 2, h / 2 - r)
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
    shape.lineTo(-w / 2 + r, h / 2)
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
    shape.lineTo(-w / 2, -h / 2 + r)
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
    shape.closePath()
    return shape
  }
  const panel = new THREE.Shape([
    new THREE.Vector2(-width / 2, -height / 2), new THREE.Vector2(width / 2, -height / 2),
    new THREE.Vector2(width / 2, height / 2), new THREE.Vector2(-width / 2, height / 2),
  ])
  panel.holes.push(rounded(windowWidth, windowHeight, 0.09))
  const seal = rounded(windowWidth, windowHeight, 0.09)
  seal.holes.push(rounded(windowWidth - 0.08, windowHeight - 0.08, 0.06))
  const add = (shape: THREE.Shape, material: THREE.Material, depth: number, name: string) => {
    const geometry = (curveSegments: number) => {
      const result = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments })
      result.rotateX(Math.PI / 2)
      result.translate(0, depth / 2, 0)
      return result
    }
    const mesh = new THREE.Mesh(geometry(6), material)
    setModelDetail(mesh, trainWindowLow(shape,depth))
    mesh.position.set(x, y, z)
    mesh.name = name
    g.add(mesh)
  }
  add(panel, mats.trainBody, 0.06, 'l-car-window-panel')
  add(seal, mats.rubber, 0.064, 'l-car-window-seal')
  add(rounded(windowWidth - 0.09, windowHeight - 0.09, 0.055), mats.glass, 0.02,
    betweenDoors ? 'l-car-big-window' : 'l-car-small-window')
  if (betweenDoors) slab(g, mats.rubber, x, y, z, 0.045, 0.066, windowHeight - 0.06).name = 'l-window-mullion'
}
