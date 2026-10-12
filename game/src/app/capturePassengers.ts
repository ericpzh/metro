// Concept figures use the same clothed mesh, pose atlas and grey material as
// the live crowd (§9.5). Capture with alpha; sheet placement keeps the foot origin.
import * as THREE from 'three'
import { passengerMesh, passengerAppearance, PASSENGER_OUTFITS, PASSENGER_WALK_FRAMES, PASSENGER_STRIDE } from '../render/passengerModel.ts'

export function capturePassengers(options: { walkCycles?: boolean; cycleView?: string; cycleHeading?: number } = {}) {
  const cycles = options.walkCycles === true
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(192, 256)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x596779, 2))
  const light = new THREE.DirectionalLight(0xffffff, 3)
  light.position.set(-3, -4, 7)
  scene.add(light)
  const mesh = passengerMesh(1)
  mesh.count = 1
  mesh.setMatrixAt(0, new THREE.Matrix4())
  scene.add(mesh)
  const pose = mesh.geometry.getAttribute('passengerPose') as THREE.InstancedBufferAttribute
  const outfit = mesh.geometry.getAttribute('passengerOutfit') as THREE.InstancedBufferAttribute
  const views = { iso: [1, 1, 1], elevation: [0, -1, 0], plan: [0, 0, 1] } as const
  const images = []
  for (const [view, direction] of Object.entries(views)) {
    if (cycles && options.cycleView && view !== options.cycleView) continue
    const camera = new THREE.OrthographicCamera(-1.05, 1.05, 1.4, -1.4, 0.1, 30)
    camera.up.set(0, view === 'plan' ? 1 : 0, view === 'plan' ? 0 : 1)
    const target = new THREE.Vector3(0, 0, view === 'plan' ? 0 : 0.9)
    camera.position.copy(target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(8))
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const origin = new THREE.Vector3().project(camera)
    for (let variant = 0; variant < PASSENGER_OUTFITS.length; variant++) {
      if (cycles && variant % 3 !== 0) continue
      outfit.setX(0, variant)
      outfit.needsUpdate = true
      // Freeze different moments of a stride, like pausing the live simulation.
      // Three walkers for every waiting passenger; heading and proportions vary too.
      const headings = cycles ? (view === 'iso' ? Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)
        : view === 'elevation' ? [0, Math.PI] : [0]) : [undefined]
      for (const cycleHeading of headings) for (let sample = 0; sample < (cycles ? PASSENGER_WALK_FRAMES : 4); sample++) {
        if (cycles && options.cycleHeading !== undefined && cycleHeading !== options.cycleHeading) continue
        const walking = cycles || sample !== 0
        const identity = variant * 4 + (cycles ? 1 : sample)
        const appearance = passengerAppearance(identity + 73)
        const heading = cycleHeading ?? ((identity * 5) % 8) * Math.PI / 4
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), heading)
        mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(), rotation,
          new THREE.Vector3(appearance[2], appearance[2], appearance[1])))
        mesh.instanceMatrix.needsUpdate = true
        mesh.setColorAt(0, new THREE.Color(appearance[3], appearance[3], appearance[3]))
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        const frame = cycles ? sample + 1 : (variant * 7 + sample * 5) % PASSENGER_WALK_FRAMES + 1
        pose.setXYZW(0, frame, frame % PASSENGER_WALK_FRAMES + 1, cycles ? 0 : .35, walking ? 1 : 0)
        pose.needsUpdate = true
        renderer.render(scene, camera)
        images.push({ id: `${view}-${cycles ? `cycle-${cycleHeading}-` : ''}${variant}-${sample}`, view, variant, sample, identity, heading, frame,
          walking, stride: PASSENGER_STRIDE, width: 192, height: 256, pixelsPerMetre: 256 / 2.8,
          origin: [(origin.x + 1) * 96, (1 - origin.y) * 128],
          png: renderer.domElement.toDataURL('image/png') })
      }
    }
  }
  mesh.userData.disposePassenger()
  mesh.geometry.dispose()
  ;(mesh.material as THREE.Material).dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return images
}
