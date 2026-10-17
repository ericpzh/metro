import * as THREE from 'three'
import { ROAD_VEHICLE_VARIANTS, roadVehicleDrawParts } from '../render/models/pieces/RoadVehicleModel.ts'
import type { RoadVehicleDetail } from '../render/models/pieces/RoadVehicleModel.ts'
import { addStationLights, applyStationRenderer } from '../render/scene/lightRig.ts'

/** Production instanced geometry under the game's lighting, for reference review. */
export function captureRoadVehicles(rear = false, detail: RoadVehicleDetail = 'high'): { png: string; models: Array<{ variant: string; detail: RoadVehicleDetail; colorTriangles: number; submittedTriangles: number; draws: number }> } {
  const width = 900, height = 360
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 3
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e8e5df'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.debug.onShaderError = (gl, program) => { throw new Error(gl.getProgramInfoLog(program) ?? 'vehicle shader failed') }
  applyStationRenderer(renderer, { alpha: 1 }); renderer.setSize(width, height)
  renderer.setClearColor(0xe8e5df)
  const order = [ROAD_VEHICLE_VARIANTS[2], ROAD_VEHICLE_VARIANTS[3], ROAD_VEHICLE_VARIANTS[0], ROAD_VEHICLE_VARIANTS[1], ROAD_VEHICLE_VARIANTS[4], ROAD_VEHICLE_VARIANTS[5]]
  const models = order.map((variant, i) => {
    const scene = new THREE.Scene(); addStationLights(scene)
    const parts = roadVehicleDrawParts(variant, detail), matrix = new THREE.Matrix4(), group = new THREE.Group()
    for (const { geometry, material } of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, 1); mesh.setMatrixAt(0, matrix)
      mesh.renderOrder = material.colorWrite ? 0 : -1; group.add(mesh)
    }
    scene.add(group)
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3())
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100)
    camera.up.set(0, 0, 1)
    camera.position.copy(center).add(new THREE.Vector3(rear ? -1.4 : 1.4, rear ? -1.8 : 1.8, .9).normalize().multiplyScalar(20))
    camera.lookAt(center); camera.updateMatrixWorld()
    const projected = new THREE.Box3()
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse))
    const half = Math.max((projected.max.y - projected.min.y) * .64, (projected.max.x - projected.min.x) / (width / height) * .57)
    camera.left = -half * width / height; camera.right = -camera.left; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    if (renderer.getContext().getError() !== renderer.getContext().NO_ERROR) throw new Error(`WebGL error rendering ${variant}`)
    const x = (i % 2) * width, y = Math.floor(i / 2) * height
    ctx.drawImage(renderer.domElement, x, y)
    ctx.fillStyle = '#333'; ctx.font = '20px sans-serif'; ctx.fillText(variant, x + 25, y + 32)
    const submittedTriangles = renderer.info.render.triangles
    group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose() })
    for (const { geometry, material } of parts) { geometry.dispose(); material.dispose() }
    return { variant, detail, colorTriangles: submittedTriangles / 2, submittedTriangles, draws: parts.length }
  })
  renderer.dispose()
  return { png: canvas.toDataURL('image/png'), models }
}
