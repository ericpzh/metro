// Paused sim, paused scenery (`SceneRenderer.setPlaying`).
//
// The crowd, station clocks, escalator bands, 闸机 leaves and trains follow the
// SIM clock: paused scenery holds its pose and resumes from where it stopped.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import fs from 'node:fs'
import { LiftSystem } from '../src/render/scene/systems/LiftSystem.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'
import { ESCALATOR_SPEED } from '../src/sim/constants.ts'

function escalatorRoll() {
  const geo = new THREE.BoxGeometry(0.3, 0.6, 0.06)
  const mat = new THREE.MeshBasicMaterial()
  const count = 4
  const runLen = 5
  return {
    parts: [new THREE.InstancedMesh(geo, mat, count), new THREE.InstancedMesh(geo, mat, count)],
    count,
    climb: new THREE.Vector3(0, 0.9701, 0.2425).normalize(),
    runLen,
    pitch: 0.4,
    dir: 1,
    phase: 0,
    yaw: 0,
    risers: new THREE.InstancedMesh(geo, mat, count),
    inclineLen: 4,
    flat: 0.5,
    stepRun: 0.3,
    stepRise: 0.1,
  }
}

test('a paused escalator holds its step band, and rolls on where it stopped', () => {
  const lifts = new LiftSystem({})
  const roll = escalatorRoll()
  lifts.escalatorRolls.push(roll)
  lifts.updateEscalators(2)
  assert.equal(roll.phase, ESCALATOR_SPEED * 2, '2 sim seconds roll the band 1 m at 0.5 m/s')
  lifts.setPlaying(false)
  lifts.updateEscalators(2)
  lifts.updateEscalators(20)
  assert.equal(roll.phase, ESCALATOR_SPEED * 2, 'paused frames move no steps, however many arrive')
  lifts.setPlaying(true)
  lifts.updateEscalators(2)
  assert.equal(roll.phase, ESCALATOR_SPEED * 4, 'resume rolls on from the frozen phase, not from zero')
})

test('a paused 闸机 holds its leaf for the passenger still queuing', () => {
  const ctx = {
    scene: new THREE.Scene(),
    mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0,
    levelBase: 0,
    ghost: false,
    hideUI: true,
    stateIntervalMs: 1000,
    lastStateTime: 0,
  }
  const crowd = new CrowdSystem(ctx)
  crowd.gateWings.push({ root: new THREE.Group(), x: 0, y: 0, z: 0, axisY: true, pending: 1, hold: 0, open: 0, target: 0 })
  const wing = crowd.gateWings[0]
  crowd.setPlaying(false)
  crowd.updateGates(1)
  assert.equal(wing.open, 0, 'a paused leaf never starts its cycle')
  assert.equal(wing.pending, 1, 'and the crossing stays queued for it')
  crowd.setPlaying(true)
  crowd.updateGates(0.1)
  assert.ok(wing.open > 0, 'resume opens the leaf the pause was holding shut')
})

test('paused train poses and doors hold mid-travel, then resume from the held pose', () => {
  const ctx = { scene: new THREE.Scene(), lastStateTime: 1000, stateIntervalMs: 1000 }
  const system = new TrainSystem(ctx)
  const group = new THREE.Group()
  group.visible = true
  group.position.x = 4
  group.userData.doorOpen = 1
  group.userData.doorSides = 3
  group.userData.doorT = [0, 0]
  system.trainSlots.set('paused-consist', {
    group,
    sig: 'paused-consist',
    from: new THREE.Vector3(0, 0, 0),
    to: new THREE.Vector3(10, 0, 0),
    active: true,
    missed: 0,
  })
  const screen = new THREE.Group()
  screen.userData.doorTarget = 1
  screen.userData.doorT = 0
  system.psdGroups.push({ group: screen, x: 0, y: 0, z: 0, half: 1, fx: 1, fy: 0 })
  system.setPlaying(false)
  system.updateTrains(2000, 1)
  assert.deepEqual(group.userData.doorT, [0, 0], 'paused consist leaves hold shut mid-command')
  assert.equal(screen.userData.doorT, 0, 'and the platform screen holds with them')
  assert.equal(group.position.x, 4, 'and the consist holds its currently displayed pose')
  ctx.lastStateTime = 2000
  system.setPlaying(true)
  system.updateTrains(2000, 1)
  assert.ok(group.userData.doorT[0] > 0, 'resume eases the consist leaves open')
  assert.ok(screen.userData.doorT > 0, 'and the screen with them')
  system.updateTrains(2100, 0.1)
  assert.equal(group.position.x, 4.6, 'resume interpolation continues from the held position')
})

test('the orchestrator forwards pause to the crowd, the lifts and the trains', () => {
  // `SceneRenderer` pulls in Vite-only artwork, so like `scene-wiring` this is a
  // source contract: every sim-driven animator must hear about the pause.
  const text = fs.readFileSync(new URL('../src/render/scene/SceneRenderer.ts', import.meta.url), 'utf8')
  const body = text.slice(text.indexOf('setPlaying(on: boolean)'))
  assert.ok(body.includes('this.crowd.setPlaying(on)'), 'the crowd keeps its freeze')
  assert.ok(body.includes('this.lifts.setPlaying(on)'), 'the escalator bands hear it too')
  assert.ok(body.includes('this.trains.setPlaying(on)'), 'and the door leaves with them')
})
