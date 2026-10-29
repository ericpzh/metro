// Concept figures use the same illustrated mesh, pose atlas and flat ink as
// the live crowd (§9.5). Capture with alpha; sheet placement keeps the foot origin.
import * as THREE from 'three'
import { passengerMesh, passengerAppearance, passengerDisplayedActivity, passengerActionChannel, PASSENGER_OUTFITS, PASSENGER_LIBRARY, PASSENGER_WALK_FRAMES, PASSENGER_WALK_PROFILES } from '../render/passengerModel.ts'
import type { PassengerDetail } from '../render/passengerModel.ts'
import { passengerIsChild, passengerWalkProfile } from '../sim/walking.ts'
import { passengerEligible } from '../render/passengerEligibility.ts'
import { PASSENGER_ACTIVITY_GARMENTS } from '../render/passengerActivities.ts'

function createCaptureContext(detail: PassengerDetail = 'full') {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(192, 256)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x596779, 2))
  const light = new THREE.DirectionalLight(0xffffff, 3)
  light.position.set(-3, -4, 7)
  scene.add(light)
  const mesh = passengerMesh(1, detail)
  mesh.count = 1
  mesh.setMatrixAt(0, new THREE.Matrix4())
  scene.add(mesh)
  return { renderer, scene, mesh, detail }
}

type CaptureContext = ReturnType<typeof createCaptureContext>
let sharedCapture: CaptureContext | undefined
export function passengerCaptureDiagnostics() {
  return sharedCapture ? { calls: sharedCapture.renderer.info.render.calls,
    triangles: sharedCapture.renderer.info.render.triangles,
    material: { opacity: (sharedCapture.mesh.material as THREE.Material).opacity,
      transparent: (sharedCapture.mesh.material as THREE.Material).transparent,
      depthWrite: (sharedCapture.mesh.material as THREE.Material).depthWrite,
      depthTest: (sharedCapture.mesh.material as THREE.Material).depthTest },
    shaderErrors: sharedCapture.renderer.info.programs?.filter(p => {
      const diagnostics = (p as unknown as { diagnostics?: { runnable: boolean } }).diagnostics
      return diagnostics && !diagnostics.runnable
    }).length ?? 0 } : null
}
function disposeContext({ renderer, mesh }: CaptureContext): void {
  mesh.userData.disposePassenger()
  mesh.geometry.dispose()
  ;(mesh.material as THREE.Material).dispose()
  mesh.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
}
export function disposePassengerCapture(): void {
  if (sharedCapture) disposeContext(sharedCapture)
  sharedCapture = undefined
}

export function capturePassengers(options: { detail?: PassengerDetail; age?: 'adult' | 'child'; walkCycles?: boolean; cycleView?: string; cycleHeading?: number; walkProfile?: number; cycleVariants?: number[]; reuseContext?: boolean; activity?: number; activityTime?: number; actionHand?: 'left' | 'right' } = {}) {
  const cycles = options.walkCycles === true
  const age = options.age ?? 'adult'
  // Bounded art batches share one GPU atlas instead of uploading it per call.
  // One-shot callers retain the existing immediate-disposal behavior.
  const detail = options.detail ?? 'full'
  if (sharedCapture && sharedCapture.detail !== detail) disposePassengerCapture()
  const context = options.reuseContext ? sharedCapture ??= createCaptureContext(detail) : createCaptureContext(detail)
  const { renderer, scene, mesh } = context
  const pose = mesh.geometry.getAttribute('passengerPose') as THREE.InstancedBufferAttribute
  const activity = mesh.geometry.getAttribute('passengerActivity') as THREE.InstancedBufferAttribute
  const garment = mesh.geometry.getAttribute('passengerGarment') as THREE.InstancedBufferAttribute
  const outfit = mesh.geometry.getAttribute('passengerOutfit') as THREE.InstancedBufferAttribute
  const views = { iso: [1, 1, 1], elevation: [0, -1, 0], plan: [0, 0, 1] } as const
  const images = []
  for (const [view, direction] of Object.entries(views)) {
    if (options.cycleView && view !== options.cycleView) continue
    const camera = new THREE.OrthographicCamera(-1.05, 1.05, 1.4, -1.4, 0.1, 30)
    camera.up.set(0, view === 'plan' ? 1 : 0, view === 'plan' ? 0 : 1)
    const target = new THREE.Vector3(0, 0, view === 'plan' ? 0 : 0.9)
    camera.position.copy(target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(8))
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const origin = new THREE.Vector3().project(camera)
    for (let variant = 0; variant < PASSENGER_OUTFITS.length; variant++) {
      if (!passengerEligible(PASSENGER_LIBRARY[variant], age)) continue
      if (options.cycleVariants && !options.cycleVariants.includes(variant)) continue
      outfit.setX(0, variant)
      outfit.needsUpdate = true
      const cloth=PASSENGER_ACTIVITY_GARMENTS[variant];garment.setXY(0,cloth[0],cloth[1]);garment.needsUpdate=true
      // Freeze different moments of a stride, like pausing the live simulation.
      // Three walkers for every waiting passenger; heading and proportions vary too.
      const headings = cycles ? (view === 'iso' ? Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)
        : view === 'elevation' ? [0, Math.PI] : [0]) : [undefined]
      for (const cycleHeading of headings) for (let sample = 0; sample < (cycles ? PASSENGER_WALK_FRAMES : 4); sample++) {
        if (options.activity && sample > 0) break
        if (cycles && options.cycleHeading !== undefined && cycleHeading !== options.cycleHeading) continue
        const walking = cycles || sample !== 0
        let identity = variant * 4 + (cycles ? 1 : sample)
        // Each complete stride keeps one identity at the requested age. Child
        // cards use the catalogue's eligible hair/bag templates, as the crowd does.
        while (passengerIsChild(identity + 73) !== (age === 'child')) identity += PASSENGER_OUTFITS.length * 4
        const appearance = passengerAppearance(identity + 73)
        const heading = cycleHeading ?? options.cycleHeading ?? ((identity * 5) % 8) * Math.PI / 4
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), heading)
        mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(), rotation,
          new THREE.Vector3(appearance[2], appearance[3], appearance[1])))
        mesh.instanceMatrix.needsUpdate = true
        mesh.setColorAt(0, new THREE.Color(appearance[4], appearance[4], appearance[4]))
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        const profile = PASSENGER_WALK_PROFILES[options.walkProfile ?? passengerWalkProfile(identity+73)]
        const index = cycles ? sample : (variant * 7 + sample * 5) % PASSENGER_WALK_FRAMES
        const frame = profile.firstFrame + index
        pose.setXYZW(0, frame, profile.firstFrame+(index+1)%PASSENGER_WALK_FRAMES, cycles ? 0 : .35, walking ? 1 : 0)
        pose.needsUpdate = true
        const action=passengerDisplayedActivity(options.activity ?? 0,variant,options.activityTime ?? 4)
        const channel=passengerActionChannel(action,variant,identity+73,options.walkProfile ?? 0,options.actionHand==='left'?2:options.actionHand==='right'?1:0)
        activity.setXYZW(0, action, options.activityTime ?? 4, index / PASSENGER_WALK_FRAMES, channel)
        activity.needsUpdate = true
        renderer.render(scene, camera)
        images.push({ id: `${age === 'child' ? 'child-' : ''}${view}-${cycles ? `cycle-${cycleHeading}-` : ''}${variant}-${sample}`, age, view, variant, sample, identity, heading, frame,
          activity: options.activity ?? 0, activityTime: options.activityTime ?? 4,
          actionHand: Math.floor(channel/PASSENGER_WALK_PROFILES.length),
          model: PASSENGER_OUTFITS[variant], sourceSha256: PASSENGER_LIBRARY[variant].sourceSha256,
          recipeSha256: PASSENGER_LIBRARY[variant].recipeSha256,
          walking, stride: profile.stride * appearance[2], walkProfile: profile.name, width: 192, height: 256, pixelsPerMetre: 256 / 2.8,
          origin: [(origin.x + 1) * 96, (1 - origin.y) * 128],
          png: renderer.domElement.toDataURL('image/png') })
      }
    }
  }
  if (!options.reuseContext) disposeContext(context)
  return images
}
