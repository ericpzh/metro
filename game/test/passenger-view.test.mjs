import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cameraRig, look } from './support/camera-rig.mjs'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'
import { passengerBody, passengerPose, passengerFrames, passengerMaterial, passengerAppearance, PASSENGER_OUTFITS, PASSENGER_EYE_HEIGHT, PASSENGER_STRIDE } from '../src/render/passengerModel.ts'
import { useStore } from '../src/app/store.ts'

for (const preset of ['iso', 'plan']) {
  test(`passenger eye view restores the ${preset} camera, lens and projection`, () => {
    const { cam, keys } = cameraRig()
    cam.setPreset(preset)
    cam.setFov(52)
    const position = cam.camera.position.clone()
    const aim = cam.controls.target.clone()
    const direction = look(cam)
    const projection = cam.activeCamera().type
    cam.beginEyeView()
    cam.setEyePose(4, 8, -8 + PASSENGER_EYE_HEIGHT, Math.PI / 2)
    assert.equal(cam.activeCamera().type, 'PerspectiveCamera')
    assert.ok(look(cam).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-10)
    keys.add('w')
    cam.panCamera(0.5)
    assert.deepEqual(cam.camera.position.toArray(), [4, 8, -6.43])
    cam.endEyeView()
    assert.ok(cam.camera.position.distanceTo(position) < 1e-10)
    assert.ok(cam.controls.target.distanceTo(aim) < 1e-10)
    assert.ok(look(cam).distanceTo(direction) < 1e-10)
    assert.equal(cam.fov(), 52)
    assert.equal(cam.camera.near, 0.5)
    assert.equal(cam.activeCamera().type, projection)
    assert.equal(cam.controls.enabled, true)
    cam.dispose()
  })
}

test('passenger view restores display settings even after changing the followed person', () => {
  const original = useStore.getState()
  useStore.setState({ hideUI: false, ortho: true, cutaway: true, overlayOn: true, hideSectionSurface: false, zoneOverlayOn: true })
  try {
    useStore.getState().followPassenger(23)
    assert.equal(useStore.getState().hideUI, true)
    assert.equal(useStore.getState().ortho, false)
    useStore.getState().followPassenger(24)
    useStore.getState().endPassengerView()
    const s = useStore.getState()
    assert.equal(s.followAgentId, null)
    assert.equal(s.hideUI, false)
    assert.equal(s.ortho, true)
    assert.equal(s.cutaway, true)
    assert.equal(s.overlayOn, true)
    assert.equal(s.zoneOverlayOn, true)
    assert.equal(s.hideSectionSurface, false)
  } finally { useStore.setState(original) }
})

test('invalid passenger ids cannot enter eye view or overwrite its saved display state', () => {
  const original = useStore.getState()
  try {
    useStore.setState({ followAgentId: null, passengerViewBefore: null, hideUI: false })
    useStore.getState().followPassenger(-1)
    useStore.getState().followPassenger(Number.NaN)
    assert.equal(useStore.getState().followAgentId, null)
    assert.equal(useStore.getState().passengerViewBefore, null)
    assert.equal(useStore.getState().hideUI, false)
  } finally { useStore.setState(original) }
})

test('eye pose uses interpolated positions and stable identity through crowd compaction', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  let pose
  let lost = false
  crowd.followAgentId = 7
  crowd.onEyePose = (...args) => { pose = args }
  crowd.onFollowLost = () => { lost = true }
  const frame = (entries) => crowd.setAgents(new Float32Array(entries), entries.length / 6, 1000)
  frame([0, 0, 0, 0, 0, 3, 10, 0, 0, 0, 0, 7])
  frame([0, 0, 0, 0, 0, 3, 10, 2, 0, 0, 0, 7])
  crowd.renderAgents(ctx.lastStateTime + 500)
  assert.ok(new THREE.Vector3(...pose.slice(0, 3)).distanceTo(new THREE.Vector3(10, 1, PASSENGER_EYE_HEIGHT * passengerAppearance(7)[1])) < 1e-10)
  assert.ok(Math.abs(pose[3] - Math.PI / 2) < 1e-6)
  frame([10, 2, 0, 0, 0, 7])
  crowd.renderAgents(ctx.lastStateTime + 1000)
  assert.ok(Math.abs(pose[3] - Math.PI / 2) < 1e-6, 'queued passenger retains their facing after a preceding slot disappears')
  const matrix = new THREE.Matrix4()
  crowd.agents.getMatrixAt(0, matrix)
  assert.equal(matrix.elements[0], 0, 'own head is hidden in first person')
  frame([])
  crowd.renderAgents(ctx.lastStateTime)
  assert.equal(lost, true, 'departing passenger exits follow instead of leaving a stranded camera')
  crowd.dispose()
  ctx.mats.blob.dispose()
})

test('outfits, proportions and grey washes follow identity through buffer reordering', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  const frame = (ids) => {
    crowd.setAgents(new Float32Array(ids.flatMap(id => [id, 0, 0, 2, 0, id])), ids.length, 1000)
    crowd.renderAgents(ctx.lastStateTime + 1000)
  }
  const appearance = (slot) => {
    const matrix = new THREE.Matrix4(), color = new THREE.Color()
    crowd.agents.getMatrixAt(slot, matrix)
    crowd.agents.getColorAt(slot, color)
    return [crowd.agents.geometry.getAttribute('passengerOutfit').getX(slot),
      new THREE.Vector3().setFromMatrixScale(matrix).toArray(), color.toArray()]
  }
  frame([3, 7, 23])
  const before = appearance(1)
  frame([7, 23, 3])
  assert.deepEqual(appearance(0), before)
  const identities = Array.from({length: 1000}, (_,i) => passengerAppearance(i))
  assert.equal(new Set(identities.map(a => a[0])).size, PASSENGER_OUTFITS.length)
  assert.ok(new Set(identities.map(a => a[1])).size > 20)
  assert.ok(new Set(identities.map(a => a[2])).size > 20)
  // Every outfit must have its own geometry and a grounded supporting foot.
  for(let outfit = 0; outfit < PASSENGER_OUTFITS.length; outfit++) {
    const idle = passengerPose(0, outfit)
    assert.notDeepEqual(idle, passengerPose(1, outfit))
    let min = Infinity, max = -Infinity
    for(let i=2; i<idle.length; i+=3) { min=Math.min(min,idle[i]);max=Math.max(max,idle[i]) }
    assert.ok(Math.abs(min) < 0.002 && max >= 1.73 && max < 1.85)
    if(outfit > 0) assert.notDeepEqual(idle, passengerPose(0, 0))
  }
  crowd.dispose()
  ctx.mats.blob.dispose()
})

test('every outfit has six distinct hairstyles attached to the animated head', () => {
  for (let outfit = 0; outfit < 4; outfit++) {
    const heads = []
    for (let hair = 0; hair < 6; hair++) {
      const variant = outfit * 6 + hair
      const idle = passengerPose(0, variant)
      heads.push(Array.from(idle).filter((_, i) => idle[i - i % 3 + 2] > 1.5))
      for (const frame of [1, 7, 13, 19]) {
        const walk = passengerPose(frame, variant)
        let top = 0, foot = Infinity
        for (let i = 2; i < walk.length; i += 3) {
          top = Math.max(top, walk[i]); foot = Math.min(foot, walk[i])
        }
        assert.ok(top > 1.6 && top < 1.9, 'hair stays on the head through the walk cycle')
        assert.ok(Math.abs(foot) < 0.002, 'hair never pulls the supporting foot below the floor')
      }
    }
    assert.equal(new Set(heads.map(h => JSON.stringify(h))).size, 6, 'all hairstyles have different visible geometry')
  }
})

test('child-sized passengers retain smaller builds, eye heights and selection', () => {
  const identities = Array.from({length: 1000}, (_,id) => ({id, appearance: passengerAppearance(id)}))
  const kids = identities.filter(({appearance:a}) => a[1] < 0.82)
  assert.ok(kids.length > 80 && kids.length < 170, 'kids form a minority of the crowd')
  assert.ok(kids.some(({appearance:a}) => a[1] * 1.73 < 1.1))
  assert.ok(identities.some(({appearance:a}) => a[1] * 1.73 > 1.9))
  for (const {appearance:a} of kids) assert.ok(a[2] < 0.97, 'child width shrinks with height')
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx), kid = kids[0]
  let eye
  crowd.followAgentId = kid.id
  crowd.onEyePose = (...args) => { eye = args }
  crowd.setAgents(new Float32Array([0,0,0,2,0,kid.id]), 1, 1000)
  crowd.renderAgents(ctx.lastStateTime + 1000)
  assert.ok(Math.abs(eye[2] - PASSENGER_EYE_HEIGHT * kid.appearance[1]) < 1e-5)
  crowd.followAgentId = null
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100)
  camera.up.set(0,0,1);camera.position.set(0,-5,1);camera.lookAt(0,0,1);camera.updateMatrixWorld(true)
  const p = new THREE.Vector3(0,0,1.6*kid.appearance[1]).project(camera)
  assert.equal(crowd.pickAgent((p.x+1)*400,(1-p.y)*400,camera,{left:0,top:0,width:800,height:800},Infinity),kid.id)
  crowd.dispose();ctx.mats.blob.dispose()
})

test('authored human mesh has human scale, grey paint shading and grounded walk poses', () => {
  const body = passengerBody()
  body.computeBoundingBox()
  assert.ok(body.boundingBox.max.z >= 1.73 && body.boundingBox.max.z < 1.85)
  assert.ok(body.index.count / 3 <= 2500, 'authored anatomy is reduced for large crowds')
  const vertex = body.attributes.position
  let volume = 0
  for (let i = 0; i < body.index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertex, body.index.getX(i))
    const b = new THREE.Vector3().fromBufferAttribute(vertex, body.index.getX(i + 1))
    const c = new THREE.Vector3().fromBufferAttribute(vertex, body.index.getX(i + 2))
    volume += a.dot(b.cross(c)) / 6
  }
  assert.ok(volume > 0.04 && volume < 0.12, 'axis conversion preserves outward-facing human surfaces, not inside-out triangles')
  const idle = passengerPose(0)
  let movingArms = 0, movingLegs = 0
  for (let frame = 1; frame <= 24; frame++) {
    const pose = passengerPose(frame)
    let foot = Infinity
    for (let i = 0; i < pose.length; i += 3) {
      foot = Math.min(foot, pose[i + 2])
      const moved = Math.hypot(pose[i] - idle[i], pose[i + 1] - idle[i + 1], pose[i + 2] - idle[i + 2])
      if (idle[i + 2] < 0.8 && moved > 0.08) movingLegs++
      if (idle[i + 2] > 0.8 && idle[i + 2] < 1.4 && Math.abs(idle[i + 1]) > 0.2 && moved > 0.08) movingArms++
    }
    assert.ok(Math.abs(foot) < 0.002, `supporting foot stays planted in frame ${frame}`)
  }
  assert.ok(movingArms > 50, 'authored walk swings arms as well as legs')
  assert.ok(movingLegs > 100, 'knees and feet change pose')
  const material = passengerMaterial()
  assert.equal(material.isMeshStandardMaterial, true)
  assert.equal(material.roughness, 1)
  assert.equal(material.metalness, 0)
  assert.equal(material.transparent, true)
  assert.equal(material.opacity, 0.94)
  assert.ok(Math.abs(material.color.r - material.color.g) < 0.02)
  body.dispose()
  material.dispose()
})

test('gait covers one complete walk cycle per stride and interpolates through its loop seam', () => {
  const before = passengerFrames(PASSENGER_STRIDE * 0.99, 0, 1)
  assert.equal(before[0], 24)
  assert.equal(before[1], 1)
  assert.ok(before[2] > 0.7)
  assert.deepEqual(passengerFrames(PASSENGER_STRIDE, 0, 1), passengerFrames(0, 0, 1))
})

test('gait follows travelled distance, survives slot reordering and settles when waiting or riding', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  const frame = (agents) => crowd.setAgents(new Float32Array(agents), agents.length / 6, 1000)
  const pose = (slot) => {
    const a = crowd.agents.geometry.getAttribute('passengerPose')
    return [a.getX(slot), a.getY(slot), a.getZ(slot), a.getW(slot)]
  }
  frame([0,0,0,1,0,3, 10,0,0,1,0,7])
  frame([0.5,0,0,1,0,3, 10.4,0,0,1,0,7])
  let time = ctx.lastStateTime + 900
  for (let i=0;i<8;i++) crowd.renderAgents(time + i*10)
  const moving = pose(1)
  assert.ok(moving[3] > 0.3, 'moving passengers use the authored walking pose')
  crowd.renderAgents(time + 970)
  const atEnd = pose(1)
  crowd.renderAgents(time + 1070)
  assert.deepEqual(pose(1).slice(0,3), atEnd.slice(0,3), 'paused/no further movement never advances the stride')
  const phase = crowd.gaitPhases[1]
  frame([10.4,0,0,2,0,7, 0.5,0,0,2,0,3])
  assert.ok(Math.abs(crowd.gaitPhases[0] - ((phase + 0.4/PASSENGER_STRIDE)%1)) < 1e-5, 'phase follows identity through reorder')
  time = ctx.lastStateTime
  for(let i=0;i<20;i++) crowd.renderAgents(time+i*50)
  assert.ok(pose(0)[3] < 0.001, 'queued passengers settle into idle')
  frame([11.4,0,1,6,0,7])
  time=ctx.lastStateTime
  for(let i=0;i<20;i++) crowd.renderAgents(time+i*50)
  assert.ok(pose(0)[3] < 0.001, 'a transported passenger does not march along the escalator')
  crowd.dispose()
  ctx.mats.blob.dispose()
})

test('pause freezes a mid-stride pose through duplicate and reordered snapshots, then resumes smoothly', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  const frame = ids => crowd.setAgents(new Float32Array(ids.flatMap(([id,x]) => [x,0,0,1,0,id])), ids.length, 1000)
  const shown = slot => {
    const matrix = new THREE.Matrix4()
    crowd.agents.getMatrixAt(slot, matrix)
    const pose = crowd.agents.geometry.getAttribute('passengerPose')
    return { matrix: matrix.toArray(), pose: [pose.getX(slot),pose.getY(slot),pose.getZ(slot),pose.getW(slot)] }
  }
  frame([[7,0],[23,3]])
  frame([[7,1],[23,4]])
  const start = ctx.lastStateTime
  for(let i=0;i<12;i++)crowd.renderAgents(start + 100 + i*20)
  crowd.setPlaying(false, start + 350)
  const paused = shown(0)
  assert.ok(paused.pose[3] > 0.8, 'paused walker has not blended into standing')
  for(let i=0;i<20;i++)crowd.renderAgents(start + 400 + i*100)
  assert.deepEqual(shown(0), paused, 'wall clock time changes neither stride nor position')
  frame([[23,4],[7,1]]) // the worker sends its current state on pause/speed changes
  crowd.renderAgents(ctx.lastStateTime + 5000)
  assert.deepEqual(shown(1), paused, 'duplicate snapshot and compaction preserve the displayed pose')
  const resumed = ctx.lastStateTime + 6000
  crowd.setPlaying(true, resumed)
  frame([[23,4],[7,1]]) // the resume control also repeats the current state
  crowd.renderAgents(resumed)
  const first = shown(1)
  assert.deepEqual(first.matrix, paused.matrix, 'resume starts at the frozen position')
  for(let i=0;i<3;i++)assert.ok(Math.abs(first.pose[i]-paused.pose[i])<1e-5)
  crowd.renderAgents(resumed + 100)
  assert.notDeepEqual(shown(1).matrix, paused.matrix, 'movement continues after resuming')
  crowd.dispose();ctx.mats.blob.dispose()
})

test('selection covers the displayed head and legs during interpolation and pause', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: true, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100)
  camera.up.set(0,0,1);camera.position.set(0,-5,1);camera.lookAt(0,0,1);camera.updateMatrixWorld(true)
  const rect={left:0,top:0,width:800,height:800}
  const click=(x,z,blocker=Infinity)=> {
    const p=new THREE.Vector3(x,0,z).project(camera)
    return crowd.pickAgent((p.x+1)*400,(1-p.y)*400,camera,rect,blocker)
  }
  crowd.setAgents(new Float32Array([0,0,0,1,0,7]),1,1000)
  crowd.setAgents(new Float32Array([4,0,0,1,0,7]),1,1000)
  const start=ctx.lastStateTime
  crowd.renderAgents(start+250)
  const height=passengerAppearance(7)[1]
  assert.equal(click(1,0.3*height),7,'legs at interpolated position are selectable')
  assert.equal(click(1,1.6*height),7,'head is selectable without aiming at one central point')
  assert.equal(click(4,1),-1,'future simulation position is not the drawn passenger')
  assert.equal(click(1,1,2),-1,'a wall in front still blocks the pick')
  crowd.setPlaying(false,start+250)
  crowd.setAgents(new Float32Array([4,0,0,1,0,7]),1,1000)
  crowd.renderAgents(ctx.lastStateTime+5000)
  assert.equal(click(1,1),7,'paused passenger stays selectable at the frozen position')
  crowd.setAgentsVisible(false)
  assert.equal(click(1,1),-1,'hidden passengers are not selected')
  crowd.dispose();ctx.mats.blob.dispose()
})


test('first person adopts the initial heading, then mouse look stays independent of passenger turns', () => {
  const {cam}=cameraRig()
  const original=look(cam).clone(), position=cam.camera.position.clone()
  cam.beginEyeView();cam.setEyePose(1,2,1.6,Math.PI/2)
  assert.ok(look(cam).distanceTo(new THREE.Vector3(0,1,0))<1e-10)
  cam.setEyePose(4,5,1.7,-Math.PI/2)
  assert.ok(look(cam).distanceTo(new THREE.Vector3(0,1,0))<1e-10, 'agent turning does not force the view to turn')
  cam.lookEyeBy(150,-100)
  const free=look(cam).clone()
  assert.ok(free.z>0.2, 'mouse up looks upward')
  assert.ok(free.x>0.2, 'mouse right turns right')
  cam.setEyePose(10,15,1.5,0)
  assert.deepEqual(cam.camera.position.toArray(),[10,15,1.5])
  assert.ok(look(cam).distanceTo(free)<1e-10, 'camera translation preserves the mouse view')
  cam.lookEyeBy(0,-10000)
  assert.ok(look(cam).z<1, 'vertical mouse look stops before the pole flips the view')
  cam.endEyeView();cam.lookEyeBy(100,100)
  assert.ok(look(cam).distanceTo(original)<1e-10)
  assert.ok(cam.camera.position.distanceTo(position)<1e-10)
  cam.beginEyeView();cam.setEyePose(0,0,1.6,0)
  assert.ok(look(cam).distanceTo(new THREE.Vector3(1,0,0))<1e-10, 'next entry resets to that passenger heading')
  cam.endEyeView();cam.dispose()
})


test('first person mouse look requires a held button and stops immediately on release', () => {
  const {cam}=cameraRig();cam.beginEyeView();cam.setEyePose(0,0,1.6,0)
  const original=look(cam).clone()
  const event=(x,y,buttons)=>({clientX:x,clientY:y,buttons,pointerType:'mouse'})
  cam.onEdgePointerMove(event(100,100,0));cam.onEdgePointerMove(event(180,50,0))
  assert.ok(look(cam).distanceTo(original)<1e-10,'hover does not change the camera')
  cam.onEyePointerDown(event(180,50,1));cam.onEdgePointerMove(event(260,20,1))
  const dragged=look(cam).clone()
  assert.ok(dragged.distanceTo(original)>0.1,'holding click allows free look')
  cam.onEdgePointerUp(event(260,20,0));cam.onEdgePointerMove(event(400,200,0))
  assert.ok(look(cam).distanceTo(dragged)<1e-10,'release freezes orientation')
  cam.onEyePointerDown(event(400,200,1));cam.onEdgePointerMove(event(400,200,1))
  assert.ok(look(cam).distanceTo(dragged)<1e-10,'new click does not jump to the old pointer position')
  cam.endEyeView();cam.dispose()
})
