// The 选择 tool's route preview (§9.5): one passenger's remaining walk, drawn as a
// light-blue line on the floor.
//
// Two halves, and both are the kind of thing that goes wrong without saying so:
//
// * `World.routeOf` — which walk the preview names. A route that starts at the
//   wrong end, that repeats ground the passenger has already covered, or that
//   carries on past a train ride across the map is *plausible* and wrong, and the
//   line looks fine either way. The determinism assertion is the other half: a
//   preview is an observation, so watching one passenger must not move anybody.
// * `writeRouteRibbon` — where the drawn line actually lies. A flat quad at a
//   segment's average height sinks into the treads of a 楼梯 in the route, and a
//   ribbon a hair too narrow leaves a notch at every bend; both are pinned here
//   as arithmetic, because a GPU test cannot see them.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { World } from '../src/sim/world.ts'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { ROUTE_LIFT, ROUTE_MAX_POINTS, ROUTE_MAX_QUADS, ROUTE_QUAD_VERTS, routeIndices, routeQuadCount, writeRouteRibbon } from '../src/render/routeLine.ts'
import { scenarioStation } from './support/scenario-station.ts'

const EPS = 1e-5

/* --------------------------------------------------------------- the ribbon */

/** The xyz triples of waypoints. */
function triples(flat) {
  const out = []
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]])
  return out
}

/** Quad `k` of a ribbon buffer, as four corner triples. */
function quad(out, k) {
  const o = k * ROUTE_QUAD_VERTS * 3
  return [
    [out[o], out[o + 1], out[o + 2]],
    [out[o + 3], out[o + 4], out[o + 5]],
    [out[o + 6], out[o + 7], out[o + 8]],
    [out[o + 9], out[o + 10], out[o + 11]],
  ]
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function len(a) {
  return Math.hypot(a[0], a[1], a[2])
}
function unit(a) {
  const l = len(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

test('a flat route paints one quad on the floor, exactly one width wide', () => {
  const points = new Float32Array([0, 0, 1, 5, 0, 1])
  const out = new Float32Array(routeQuadCount(2) * ROUTE_QUAD_VERTS * 3)
  const quads = writeRouteRibbon(points, out, 0.2, 0.05)
  assert.equal(quads, 1, 'two waypoints are one segment and no joint')
  const corners = quad(out, 0)
  for (const c of corners) {
    assert.ok(Math.abs(c[2] - 1.05) < EPS, `the ribbon floats ${ROUTE_LIFT} m above the walk surface, got z=${c[2]}`)
  }
  const xs = corners.map((c) => c[0])
  assert.equal(Math.min(...xs), 0)
  assert.equal(Math.max(...xs), 5, 'the ribbon spans the whole segment')
  const ys = corners.map((c) => c[1])
  assert.ok(Math.abs(Math.max(...ys) - 0.1) < EPS && Math.abs(Math.min(...ys) + 0.1) < EPS, 'and is 0.2 m across')
})

test('a sloped segment lies in the slope, not on a flat plane at its average height', () => {
  // A 45° run — a 楼梯 in the route. A quad laid flat at z = 3 would be buried at
  // both ends of the flight.
  const a = [0, 0, 1]
  const b = [4, 0, 5]
  const points = new Float32Array([...a, ...b])
  const out = new Float32Array(64)
  assert.equal(writeRouteRibbon(points, out, 0.2, ROUTE_LIFT), 1)
  const corners = quad(out, 0)
  const d = unit(sub(b, a))
  const side = unit([d[1], -d[0], 0])
  const normal = unit([side[1] * d[2], -side[0] * d[2], side[0] * d[1] - side[1] * d[0]])
  corners.forEach((c, i) => {
    const end = i < 2 ? a : b
    const off = sub(c, end)
    // The corner is the segment end, lifted along the surface normal by exactly
    // `lift`, and pushed half a width along the slope's horizontal strike.
    assert.ok(Math.abs(dot(off, normal) - ROUTE_LIFT) < EPS, 'the corner sits on the lifted slope plane')
    assert.ok(Math.abs(dot(off, d)) < EPS, 'the cross-section is square to the run')
    const across = sub(off, [normal[0] * ROUTE_LIFT, normal[1] * ROUTE_LIFT, normal[2] * ROUTE_LIFT])
    assert.ok(Math.abs(len(across) - 0.1) < EPS, 'and is half a width from the centreline')
    assert.ok(Math.abs(c[2] - (end[2] + normal[2] * ROUTE_LIFT)) < EPS, 'so the ribbon climbs with the run')
  })
})

test('a bend is filled: the joint quad covers both segment ends it joins', () => {
  const points = new Float32Array([0, 0, 1, 2, 0, 1, 2, 2, 1])
  const out = new Float32Array(routeQuadCount(3) * ROUTE_QUAD_VERTS * 3)
  const quads = writeRouteRibbon(points, out, 0.2, ROUTE_LIFT)
  assert.equal(quads, 3, 'two segments and the joint between them')

  // The two corners the segments leave at the bend, one from each run: the first
  // segment's end edge, and the second's start edge.
  const segA = quad(out, 0)
  const segB = quad(out, 1)
  const joint = quad(out, 2)
  const corner = [segA[3], segB[0]]
  const centre = [0, 1, 2].map((i) => (joint[0][i] + joint[1][i] + joint[2][i] + joint[3][i]) / 4)
  const axisS = unit(sub(joint[0], joint[3]))
  const axisD = unit(sub(joint[0], joint[1]))
  const halfS = len(sub(joint[0], joint[3])) / 2
  const halfD = len(sub(joint[0], joint[1])) / 2
  for (const c of corner) {
    const off = sub(c, centre)
    // In the joint's own frame the square is `± half` along both axes, and it is
    // the disc of that radius the two segment ends leave behind.
    assert.ok(Math.abs(dot(off, axisS)) <= halfS + EPS, 'the segment corner is inside the joint across the ribbon')
    assert.ok(Math.abs(dot(off, axisD)) <= halfD + EPS, 'and along it')
  }
})

test('a route shorter than two waypoints draws nothing', () => {
  const out = new Float32Array(64)
  assert.equal(writeRouteRibbon(new Float32Array(0), out), 0)
  assert.equal(writeRouteRibbon(new Float32Array([1, 2, 3]), out), 0)
  assert.equal(routeQuadCount(0), 0)
  assert.equal(routeQuadCount(1), 0)
  assert.equal(routeQuadCount(4), 5, 'three segments and the two joints between them')
})

test('the index buffer walks the quads in order, so the draw range can pick the used part', () => {
  const idx = routeIndices(3)
  assert.equal(idx.length, 18)
  assert.deepEqual([...idx.slice(0, 6)], [0, 1, 2, 0, 2, 3])
  assert.deepEqual([...idx.slice(6, 12)], [4, 5, 6, 4, 6, 7])
  assert.deepEqual([...idx.slice(12, 18)], [8, 9, 10, 8, 10, 11])
})

test('a polyline past the cap is clamped by the writer, not by its caller', () => {
  // The scene sizes its buffer from `ROUTE_MAX_QUADS`, so a longer route written
  // whole would run off the end of a typed array: the tail is dropped in silence
  // and the draw range goes on reading whatever was there before. The clamp is
  // therefore the writer's own.
  const points = new Float32Array((ROUTE_MAX_POINTS + 40) * 3)
  for (let i = 0; i < points.length / 3; i++) {
    points[i * 3] = i
    points[i * 3 + 2] = 1
  }
  const out = new Float32Array(ROUTE_MAX_QUADS * ROUTE_QUAD_VERTS * 3)
  const quads = writeRouteRibbon(points, out, 0.2, ROUTE_LIFT)
  assert.equal(quads, routeQuadCount(ROUTE_MAX_POINTS), 'the cap is what was written')
  assert.ok(quads <= ROUTE_MAX_QUADS, `and it fits the buffer the scene sized (${quads} quads)`)
  // Nothing past the clamp: the last quad's corners are the last *waypoint inside*
  // the cap, not a fragment of the one that was cut.
  const last = quad(out, quads - 1)
  const cut = ROUTE_MAX_POINTS - 1
  assert.ok(Math.max(...last.map((c) => c[0])) <= cut + 0.2, 'the drawn ribbon stops at the cap')
})

/* --------------------------------------------------------------- the route */

/** Every graph node's xyz, packed the way a route's waypoints are, as a key set. */
function nodeKeys(graph) {
  const s = new Set()
  for (let n = 0; n < graph.nodeCount; n++) {
    s.add(`${graph.nodeX[n].toFixed(3)},${graph.nodeY[n].toFixed(3)},${graph.nodeZ[n].toFixed(3)}`)
  }
  return s
}

const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`

/** A waypoint against a float64 world position: the buffer carries float32. */
function samePoint(a, b, eps = 1e-5) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps
}

function positions(world) {
  return world.pool.live.map((a) => [a.id, a.x, a.y, a.z, a.state])
}

test('a route starts at the passenger and follows the leg they are walking', () => {
  const world = new World(scenarioStation(), 24680)
  for (let i = 0; i < 60; i++) world.tickOnce()
  const g = world.graph
  const nodes = nodeKeys(g)
  const walkers = world.pool.live.filter((a) => a.pathIdx < a.path.length)
  assert.ok(walkers.length > 20, `expected a walking crowd, got ${walkers.length}`)

  for (const a of walkers) {
    const route = world.routeOf(a.id)
    assert.ok(route !== null, 'a live passenger has a route')
    const pts = triples(route)
    assert.ok(samePoint(pts[0], [a.x, a.y, a.z]), 'the line starts under the passenger')
    assert.ok(
      samePoint(pts[1], [g.nodeX[a.path[a.pathIdx]], g.nodeY[a.path[a.pathIdx]], g.nodeZ[a.path[a.pathIdx]]]),
      'and goes on to the node they are walking to — not back over ground already covered',
    )
    for (const p of pts.slice(1)) {
      assert.ok(nodes.has(key(p)), `every waypoint after the first is a graph node, got ${key(p)}`)
    }
  }
})

test('the preview ends where the passenger boards, not across the tunnel', () => {
  const world = new World(scenarioStation(), 991)
  let checked = 0
  for (let i = 0; i < 300 && checked === 0; i++) {
    world.tickOnce()
    for (const a of world.pool.live) {
      const leg = a.legs[a.legIdx]
      // Mid-walk or waiting for a path: a passenger already queuing at the door has
      // finished the walk the preview draws.
      if (!leg || leg.kind !== 'line' || a.door < 0 || !(a.pathIdx < a.path.length || a.awaitingPath)) continue
      const route = world.routeOf(a.id)
      assert.ok(route !== null)
      const pts = triples(route)
      const door = world.graph.servers[a.door].node
      assert.ok(
        samePoint(pts[pts.length - 1], [world.graph.nodeX[door], world.graph.nodeY[door], world.graph.nodeZ[door]]),
        'a line leg ends at the platform door the passenger is queuing for: a train ride is not walked',
      )
      assert.ok(pts.length > 1, 'and the line reaches it rather than collapsing to a point')
      checked++
      break
    }
  }
  assert.equal(checked, 1, 'the crowd reached the platform within the run')
})

test('an agent that is not in the world has no route', () => {
  const world = new World(scenarioStation(), 5150)
  assert.equal(world.routeOf(-1), null)
  assert.equal(world.routeOf(999999), null)
  for (let i = 0; i < 20; i++) world.tickOnce()
  const gone = world.pool.live[0]
  world.pool.kill(gone)
  assert.equal(world.routeOf(gone.id), null, 'a dead passenger is not previewed')
})

test('reading a route never changes the simulation', () => {
  // §7.6: the preview is an observation. Watching one passenger must not move
  // anybody, and it must not disturb the RNG stream the crowd is drawn from.
  const watched = new World(scenarioStation(), 13579)
  const control = new World(scenarioStation(), 13579)
  for (let i = 0; i < 400; i++) {
    watched.tickOnce()
    for (let k = 0; k < Math.min(8, watched.pool.live.length); k++) watched.routeOf(watched.pool.live[k].id)
    control.tickOnce()
  }
  assert.deepEqual(positions(watched), positions(control))
  assert.equal(watched.rng.state, control.rng.state, 'the preview draws no randomness')
  assert.ok(watched.pool.count > 100, 'and a real crowd was watched')
})

test('the leg memo is bounded, and a re-cut graph drops it whole', () => {
  // The tails are the only thing the preview keeps between frames, so a memo that
  // grew with every passenger ever watched would be an invisible leak; and every
  // tail is a list of *node ids*, so a re-cut graph makes all of them stale.
  const world = new World(scenarioStation(), 8642)
  for (let i = 0; i < 300; i++) {
    world.tickOnce()
    // Watch a different passenger every tick: the hardest case for the memo.
    for (const a of world.pool.live) world.routeOf(a.id)
    if (i % 50 === 0) assert.ok(world.routeTails.size <= 256, `the memo stays bounded (${world.routeTails.size} entries)`)
  }
  assert.ok(world.routeTails.size > 0, 'the fixture did memoise something')

  world.rebuild()
  assert.equal(world.routeTails.size, 0, 'a rebuild drops the tails rather than leaving stale node ids behind')
})

/* ------------------------------------------------------- the line and the pick */

// The scene half needs no GPU: `CrowdSystem` only ever adds meshes to a scene, so
// what it draws for a route — and which body its pick answers with — is arithmetic
// over the same buffers the app feeds it.

const B2 = -8
const B1 = -4

/** A `CrowdSystem` with no renderer behind it, editing storey `activeZ`. */
function crowdSystem(activeZ = B2) {
  const scene = new THREE.Scene()
  const ctx = new SceneContextData(scene, { blob: new THREE.MeshBasicMaterial() }, {}, {})
  ctx.activeZ = activeZ
  return new CrowdSystem(ctx)
}

/** A crowd frame of `[x, y, z, state, phase, id]` per agent. */
function agentBuffer(agents) {
  const buf = new Float32Array(agents.length * 6)
  agents.forEach((a, i) => {
    buf[i * 6] = a.x
    buf[i * 6 + 1] = a.y
    buf[i * 6 + 2] = a.z
    buf[i * 6 + 5] = a.id
  })
  return buf
}

test('the route is drawn as a ribbon and ringed at its destination', () => {
  const crowd = crowdSystem()
  const points = new Float32Array([0, 0, B2 + 1, 5, 0, B2 + 1, 5, 6, B2 + 1])
  crowd.setRoute(points, 7)
  assert.equal(crowd.routeAgentId, 7)
  assert.equal(crowd.route.visible, true, 'the line is up')
  assert.equal(crowd.route.geometry.drawRange.count, 3 * 6, 'one quad per segment and per joint, six indices each')
  assert.ok(crowd.destRing.visible, 'and the destination is ringed')
  assert.ok(Math.abs(crowd.destRing.position.x - 5) < EPS && Math.abs(crowd.destRing.position.y - 6) < EPS)
  assert.ok(Math.abs(crowd.destRing.position.z - (B2 + 1 + ROUTE_LIFT)) < EPS, 'the ring lies on the floor, not in it')

  // A passenger with nothing left to walk has no line to draw — only a person.
  crowd.setRoute(new Float32Array([0, 0, B2 + 1]), 7)
  assert.equal(crowd.route.visible, false)
  assert.equal(crowd.destRing.visible, false)
})

test('a route past the cap is clamped on the way into the buffer', () => {
  // `setRoute` is the scene's own guard on top of the writer's: whatever the sim
  // hands over (a leg with a pathological number of nodes), the draw range and the
  // upload stay inside the buffers that were sized for `ROUTE_MAX_QUADS`.
  const crowd = crowdSystem(B2)
  const points = new Float32Array((ROUTE_MAX_POINTS + 500) * 3)
  for (let i = 0; i < points.length / 3; i++) {
    points[i * 3] = i * 0.5
    points[i * 3 + 2] = B2 + 1
  }
  crowd.setRoute(points, 9)
  const quads = routeQuadCount(ROUTE_MAX_POINTS)
  assert.equal(crowd.route.geometry.drawRange.count, quads * 6, `the draw range is the clamped quad count (${quads})`)
  assert.ok(crowd.route.geometry.drawRange.count <= ROUTE_MAX_QUADS * 6, 'and fits the index buffer')
  assert.ok(Number.isFinite(crowd.destRing.position.x), 'the destination ring sits on the clamped last waypoint')
  const clamped = (ROUTE_MAX_POINTS - 1) * 0.5
  assert.ok(crowd.destRing.position.x <= clamped + 1e-4, `the ring is not drawn past the clamp (${crowd.destRing.position.x})`)
})

test('the clip list carries the preview, so 剖切 fades it with the crowd', () => {
  // `SectionSystem` clips a level by mutating the materials a system hands over:
  // a route drawn with a material that is not in that list would keep painting
  // through the cut, and the crowd's own meshes would part company with it.
  const crowd = crowdSystem(B2)
  const mats = crowd.clipMaterials()
  for (const [what, mat] of [
    ['the route', crowd.route.material],
    ['the passenger ring', crowd.agentRing.material],
    ['the destination ring', crowd.destRing.material],
  ]) {
    assert.ok(mats.includes(mat), `${what}'s material is handed to the section`)
  }
  assert.deepEqual(crowd.clipMaterials(), mats, 'and the same list comes back on the next frame')
})

test('the route and its ring follow the passenger, and go with the storey that hides them', () => {
  const crowd = crowdSystem(B2)
  crowd.setAgents(agentBuffer([{ id: 4, x: 2, y: 3, z: B2 + 1 }]), 1, 200)
  crowd.setRoute(new Float32Array([2, 3, B2 + 1, 8, 3, B2 + 1]), 4)
  crowd.renderAgents(performance.now())
  assert.equal(crowd.agentRing.visible, true, 'the previewed passenger wears a ring')
  assert.equal(crowd.route.visible, true, 'and their route is drawn')
  assert.ok(Math.abs(crowd.agentRing.position.x - 2) < EPS && Math.abs(crowd.agentRing.position.y - 3) < EPS)

  // The same frame with 显示其他层 off and the storey being edited moved up: a floor
  // that is not drawn would leave the line and the ring hanging over nothing.
  crowd.ctx.ghost = false
  crowd.ctx.activeZ = B1
  crowd.renderAgents(performance.now())
  assert.equal(crowd.agentRing.visible, false)
  assert.equal(crowd.route.visible, false, 'the route belongs to the passenger')
  assert.equal(crowd.destRing.visible, false)

  // And 隐藏UI is the exception: it draws every storey, so it draws the crowd on it.
  crowd.ctx.hideUI = true
  crowd.renderAgents(performance.now())
  assert.equal(crowd.agentRing.visible, true)
})

test('hiding the crowd takes the route preview with it', () => {
  const crowd = crowdSystem(B2)
  crowd.setAgents(agentBuffer([{ id: 4, x: 2, y: 3, z: B2 + 1 }]), 1, 200)
  crowd.setRoute(new Float32Array([2, 3, B2 + 1, 8, 3, B2 + 1]), 4)
  crowd.renderAgents(performance.now())
  crowd.setAgentsVisible(false)
  assert.equal(crowd.route.visible, false)
  // The next frame must not put it back: the crowd's own switch is held.
  crowd.renderAgents(performance.now())
  assert.equal(crowd.route.visible, false)
  crowd.setAgentsVisible(true)
  crowd.renderAgents(performance.now())
  assert.equal(crowd.route.visible, true)
})

test('the pick answers with the passenger under the pointer', () => {
  const crowd = crowdSystem(B2)
  const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 500)
  camera.position.set(14, 16, 6)
  camera.lookAt(2, 3, B2 + 1)
  camera.updateMatrixWorld(true)

  const rect = { left: 0, top: 0, width: 800, height: 600 }
  const at = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height }
  }
  crowd.setAgents(agentBuffer([
    { id: 11, x: 2, y: 3, z: B2 + 1 },
    { id: 12, x: 6, y: 5, z: B2 + 1 },
  ]), 2, 200)

  const p11 = at(2, 3, B2 + 1 + 0.45)
  assert.equal(crowd.pickAgent(p11.x, p11.y, camera, rect, Infinity), 11, 'a click on the body picks that passenger')
  assert.equal(crowd.pickAgent(p11.x + 6, p11.y, camera, rect, Infinity), 11, 'and a click beside it, inside the radius, still does')
  assert.equal(crowd.pickAgent(p11.x + 40, p11.y, camera, rect, Infinity), -1, 'a click on open floor picks nobody')

  // A wall in front of the passenger is what makes them invisible on screen.
  const depth = camera.position.distanceTo(new THREE.Vector3(2, 3, B2 + 1))
  assert.equal(crowd.pickAgent(p11.x, p11.y, camera, rect, depth - 3), -1, 'a body behind a nearer solid face is not picked')
  assert.equal(crowd.pickAgent(p11.x, p11.y, camera, rect, depth + 3), 11, 'a face behind the body hides nothing')

  // Two bodies within a few centimetres of each other: the one in front is the one
  // the player aimed at, so the nearer camera depth wins the tie.
  crowd.setAgents(agentBuffer([
    { id: 21, x: 2, y: 3, z: B2 + 1 },
    { id: 22, x: 2.02, y: 3, z: B2 + 1 },
  ]), 2, 200)
  const pick = crowd.pickAgent(p11.x, p11.y, camera, rect, Infinity)
  const depths = [
    { id: 21, d: camera.position.distanceTo(new THREE.Vector3(2, 3, B2 + 1)) },
    { id: 22, d: camera.position.distanceTo(new THREE.Vector3(2.02, 3, B2 + 1)) },
  ].sort((a, b) => a.d - b.d)
  assert.equal(pick, depths[0].id, 'a click on a stack picks the body nearer the camera')

  // Nothing on a storey the slice hides is pickable either: 显示其他层 off and the
  // storey being edited moved up takes the crowd off the screen, so it takes it out
  // of the pick with it.
  crowd.ctx.ghost = false
  crowd.ctx.activeZ = B1
  assert.equal(crowd.pickAgent(p11.x, p11.y, camera, rect, Infinity), -1, 'a hidden storey is not pickable')
  crowd.ctx.activeZ = B2
  crowd.setAgents(new Float32Array(0), 0, 200)
  assert.equal(crowd.pickAgent(p11.x, p11.y, camera, rect, Infinity), -1, 'an empty station picks nobody')
})
