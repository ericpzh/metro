import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'

/** A/B stock's inset windows leave broad painted pillars beside every doorway (§1.12). */
export function buildBWindowBay(g: THREE.Group, mats: ModelMaterials, a: number, b: number,
  y: number, sill: number, head: number, glazed: boolean, stock: 'A' | 'B' = 'B'): void {
  const width = b - a, height = head - sill, x = (a + b) / 2, z = (sill + head) / 2
  if (!glazed) {
    slab(g, mats.trainBody, x, y, z, width, 0.06, height)
    return
  }
  const windowWidth = Math.min(1.85, width - 0.7), windowHeight = height - 0.16
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
  panel.holes.push(rounded(windowWidth, windowHeight, 0.1))
  const seal = rounded(windowWidth, windowHeight, 0.1)
  seal.holes.push(rounded(windowWidth - 0.08, windowHeight - 0.08, 0.07))
  const add = (shape: THREE.Shape, material: THREE.Material, depth: number, name: string) => {
    const geometry = (curveSegments: number) => {
      const result = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments })
      result.rotateX(Math.PI / 2)
      result.translate(0, depth / 2, 0)
      return result
    }
    const mesh = new THREE.Mesh(geometry(6), material)
    // Low keeps the aperture and rubber surround, with chamfered corners.
    setModelDetail(mesh, geometry(1))
    mesh.position.set(x, y, z)
    mesh.name = name
    g.add(mesh)
  }
  add(panel, mats.trainBody, 0.06, `${stock.toLowerCase()}-car-window-panel`)
  add(seal, mats.rubber, 0.064, `${stock.toLowerCase()}-car-window-seal`)
  add(rounded(windowWidth - 0.09, windowHeight - 0.09, 0.065), mats.glass, 0.02, `${stock.toLowerCase()}-car-window`)
}
