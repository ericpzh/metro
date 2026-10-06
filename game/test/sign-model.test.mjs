// The model's own 指示牌 build (`render/models.ts` `buildSign`).
//
// This is the one path the drawing tests cannot reach: they hand `drawSignPanel` a
// layout and read the pixels back, whereas a placed sign gets its plate from the
// scene's cache (`render/scene.ts`) and its mesh from `buildSign`. A bug in either —
// an empty layout, a face the model decides not to mount, a plate built at the wrong
// size — leaves a black rectangle in the station with no error anywhere, which is
// exactly the failure this file exists to catch.
//
// It runs in Node by stubbing `document.createElement('canvas')` with a recording
// context, so `createModelMaterials` and the sign's plate are the real ones.
import test from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------- canvas stub
// `models.ts` reaches for a canvas at import time (module materials), so the stub has
// to be installed before anything from it is imported.
const canvases = []
function makeCanvas() {
  const ops = { fills: [], texts: [] }
  const g = {
    canvas: null,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    roundRect: () => {},
    arc: () => {},
    arcTo: () => {},
    ellipse: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    resetTransform: () => {},
    clip: () => {},
    clearRect: () => {},
    createPattern: () => null,
    fill: () => ops.fills.push(String(g.fillStyle)),
    fillRect: () => ops.fills.push(String(g.fillStyle)),
    stroke: () => {},
    strokeRect: () => {},
    fillText: (t) => ops.texts.push(String(t)),
    measureText: (t) => ({ width: String(t).length * (parseFloat(g.font) || 10) * 0.95 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    drawImage: () => {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
  }
  const c = { width: 0, height: 0, ops, getContext: () => g, toDataURL: () => 'data:,' }
  g.canvas = c
  canvases.push(c)
  return c
}

globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild: () => {}, setAttribute: () => {} }),
}

const THREE = await import('three')
const { buildModule, createModelMaterials, litPanelMaterial } = await import('../src/render/models.ts')
const { createModule, toState } = await import('../src/build/model.ts')

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#a6224a',
  stock: 'B',
  cars: 6,
  power: 'third-rail',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420,
  terminus: 'through',
  direction: 'up',
  upTerminus: '',
  downTerminus: '',
  travelSign: 1,
  stations: [],
}

const STATION = toState({
  name: '指示牌',
  seed: 1,
  cells: [{ x: 2, y: 3, z: 0, fill: 'solid' }, { x: 2, y: 3, z: 4, fill: 'solid' }],
  modules: [],
  lines: [LINE],
})

/**
 * Build one sign the way the scene does, returning the meshes and the plates it asked
 * for. `boards` is the pair a sign is placed with — `{ front, back }` — so a test can
 * state the two faces as the two boards they are, including an empty back. `type` picks
 * the mount, which is the piece's own (`sign-ceiling` / `sign-wall`).
 */
function buildSignMeshes(boards = { front: [], back: [] }, type = 'sign') {
  const mod = createModule(type, 2, 3, 0, `sign-${type}`, 0, undefined, 'up', 'right', [LINE], boards)
  assert.equal(mod.type, 'sign')
  const plates = []
  const mats = createModelMaterials()
  const ctx = {
    mats,
    ads: { poster: () => null, slugFor: () => '' },
    data: STATION,
    trackCells: new Set(),
    finish: () => mats.black,
    tvPlate: () => mats.screen.map,
    // The scene's own face builder, reproduced: a material over the plate's texture,
    // which is what the model mounts.
    signFace: (id, layout, face, panel) => {
      const before = canvases.length
      const material = createModelMaterialsPlate(layout, face, panel)
      plates.push({ id, face, canvas: canvases[before] })
      return material
    },
  }
  const group = buildModule(mod, ctx)
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  return { mod, group, meshes, plates }
}

// The plate has to be minted the way the scene mints it, so the canvas the model gets
// is the one the test can read back. The scene wraps it with `litPanelMaterial`, which
// is the very thing under test, so the model test calls the same function.
const { drawSignPanel } = await import('../src/render/signFace.ts')
const { PANEL_MIN_H, SIGN_WALL_PANEL_Z, signPlate } = await import('../src/sim/sign.ts')
function createModelMaterialsPlate(layout, face, panel) {
  const plate = signPlate(panel)
  const c = makeCanvas()
  c.width = plate.width
  c.height = plate.height
  drawSignPanel(c.getContext('2d'), layout, { lines: [LINE], panel }, face)
  return litPanelMaterial(new THREE.CanvasTexture(c))
}

/**
 * The planes a sign hangs as its lit faces. A face is a `MeshBasicMaterial` whose map
 * is the board's plate — and the bug this file guards against is precisely that it was
 * a bare texture instead, which no mesh can draw.
 */
function litFaces(meshes) {
  return meshes.filter((m) => m.geometry.type === 'PlaneGeometry')
}

/**
 * Which way a lit face looks. `plate` turns a face by its yaw, so the plane's world
 * normal is the one thing that says which side of the sign a plate is on: the front
 * (正面) faces `+y`, its neighbour the back (背面) faces `−y`. Both are +z after the
 * upright rotation, so the y component is the face.
 */
function faceNormalY(mesh) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())).y
}

const FRONT = [
  { id: 'c1', kind: 'line', lineId: '5', english: true, x: 0.27, y: 0.35, scale: 1, side: 'both' },
  { id: 'c2', kind: 'icon', icon: 'exit', x: 0.81, y: 0.35, scale: 1, side: 'both' },
]
const BACK = [
  { id: 'b1', kind: 'icon', icon: 'lift', x: 0.27, y: 0.35, scale: 1, side: 'both' },
  { id: 'b2', kind: 'text', text: '出站', x: 0.81, y: 0.35, scale: 1, side: 'both' },
]

test('a placed sign hangs a lit face per composed board, each printing its own', () => {
  const { meshes, plates } = buildSignMeshes({ front: FRONT, back: BACK })
  assert.ok(meshes.length > 0, 'the sign builds meshes')
  // One plate per face, and each is drawn from **its own** board: the shield and the
  // 出口 plate are the front's, the lift and the label are the back's. A sign whose
  // faces came out identical is the bug this asserts against — the two boards are
  // independent documents, so the back is not a copy of the front.
  assert.deepEqual(plates.map((p) => p.face), ['left', 'right'], 'both faces are mounted')
  const [front, back] = plates
  assert.ok(front.canvas.ops.fills.includes('#a6224a'), 'the front prints its shield')
  assert.ok(front.canvas.ops.fills.includes('#1f9c5e'), 'the front prints the 出口 plate')
  assert.ok(front.canvas.ops.texts.includes('5号线'), 'the front prints the line name')
  assert.ok(!back.canvas.ops.fills.includes('#a6224a'), 'the back does not print the front’s shield')
  assert.ok(back.canvas.ops.texts.includes('出'), 'the back prints its own label')

  // A textured plate mesh per face, wearing a **material** whose map is the plate.
  // Handing the mesh the texture itself is the bug that made every sign in the station
  // black: the "material" is then a Texture, which has no `isMeshBasicMaterial` and
  // cannot draw, so the face vanishes and the model's dark lightbox shows through.
  const lit = litFaces(meshes)
  assert.equal(lit.length, 2, `two lit faces (got ${lit.length} planes of ${meshes.length} meshes)`)
  for (const [i, m] of lit.entries()) {
    assert.equal(m.material?.isMeshBasicMaterial, true, `face ${i} wears a material, not a bare texture`)
    assert.ok(m.material.map, `face ${i} has its plate as the map`)
    assert.ok(m.material.map.image, `face ${i}'s map has an image behind it`)
  }
  // ...and they face **opposite ways**, which is what makes the back readable from
  // behind rather than a mirror of the front: the plate's own yaw turns each one toward
  // the passenger it serves, and no board is redrawn to do it.
  const normals = lit.map(faceNormalY).sort((a, b) => a - b)
  assert.deepEqual(normals.map((n) => Math.round(n)), [-1, 1], `the two faces look opposite ways (${normals})`)
})

test('a sign with no board of its own prints the default front, and an empty back', () => {
  // The silent failure this guards: an empty board on both faces would mount no plate
  // at all, and the piece would be a black rectangle in the station. The **front** is
  // therefore never allowed to be empty — `signBoardsOf` fills it with the station's
  // default board — while the back, having nothing composed, stays black.
  const { plates, meshes } = buildSignMeshes({ front: [], back: [] })
  assert.deepEqual(plates.map((p) => p.face), ['left'], 'only the front is lit')
  assert.ok(plates[0].canvas.ops.texts.length > 0, 'the front board prints something')
  assert.equal(litFaces(meshes).length, 1, 'and the back is the model’s own black panel')

  // The same holds for a module that predates boards entirely (`cfg: {}`), which is the
  // shape a save from before the editor had one arrives in.
  const legacy = { id: 'sign-1', type: 'sign', x: 2, y: 3, z: 0, rot: 0, cfg: {} }
  const mats = createModelMaterials()
  const asked = []
  const group = buildModule(legacy, {
    mats,
    ads: { poster: () => null, slugFor: () => '' },
    data: STATION,
    trackCells: new Set(),
    finish: () => mats.black,
    tvPlate: () => mats.screen.map,
    signFace: (id, layout, face, panel) => {
      asked.push({ face, layout, panel })
      return createModelMaterialsPlate(layout, face, panel)
    },
  })
  assert.deepEqual(asked.map((a) => a.face), ['left'], 'a legacy sign is backfilled on the front only')
  assert.ok(asked[0].layout.length > 0, 'and that front carries the default board')
  assert.ok(litFaces((() => {
    const out = []
    group.traverse((o) => {
      if (o.isMesh) out.push(o)
    })
    return out
  })()).length === 1)
})

test('a sign whose back is empty mounts one lit face, and a two-sided one mounts two', () => {
  // The ordinary case: a fresh sign is one-sided. One plate, one plane.
  const oneSided = buildSignMeshes({ front: FRONT, back: [] })
  assert.deepEqual(oneSided.plates.map((p) => p.face), ['left'], 'only the front carries a board')
  const frontPlanes = litFaces(oneSided.meshes)
  assert.equal(frontPlanes.length, 1, `one lit face (got ${frontPlanes.length} planes)`)
  assert.equal(frontPlanes[0].material.isMeshBasicMaterial, true)
  assert.equal(Math.round(faceNormalY(frontPlanes[0])), 1, 'and it is the front, facing +y')

  // Compose the back and the same piece hangs a second plate, facing the other way.
  const twoSided = buildSignMeshes({ front: FRONT, back: BACK })
  assert.deepEqual(twoSided.plates.map((p) => p.face), ['left', 'right'])
  assert.equal(litFaces(twoSided.meshes).length, 2)
})

test('the two plates share the longer board’s panel', () => {
  // A sign is one piece of hardware: a short back prints on the same steel as a long
  // front rather than shrinking the sign or hanging off it.
  const { plates, meshes } = buildSignMeshes({ front: FRONT, back: [BACK[0]] })
  const widths = [...new Set(plates.map((p) => p.canvas.width))]
  assert.equal(widths.length, 1, `one plate width for both faces (got ${widths})`)
  assert.equal(plates[0].canvas.width, plates[1].canvas.width)
  // And the mesh the plate is drawn on is cut to that same panel, minus the frame.
  const planes = litFaces(meshes)
  const widths3d = [...new Set(planes.map((m) => Math.round(m.geometry.parameters.width * 1000)))]
  assert.equal(widths3d.length, 1, `one mesh width for both faces (got ${widths3d})`)
})

test('a wall sign is a panel on the wall: one lit face into the room, and no rods', () => {
  // The **wall** mount is the same board bolted flat to the wall on the piece's local
  // −y face — the wall is behind it, so 背面 has no plate to print on — and it hangs on
  // nothing, so it carries none of the suspension the overhead board is built with.
  const wall = buildSignMeshes({ front: FRONT, back: BACK }, 'sign-wall')
  assert.deepEqual(wall.plates.map((p) => p.face), ['left'], 'only 正面 is mounted')
  assert.ok(wall.plates[0].canvas.ops.fills.includes('#a6224a'), 'and it is the front’s own board that prints')
  assert.ok(!wall.plates[0].canvas.ops.texts.includes('电梯'), 'the back’s label never reaches the wall')

  // One plane, facing **into the room** (+y) — the same way the hung board's front
  // looks, and the opposite of a plate hung on the wall itself.
  const lit = litFaces(wall.meshes)
  assert.equal(lit.length, 1, `one lit face (got ${lit.length} planes)`)
  assert.equal(lit[0].material?.isMeshBasicMaterial, true, 'and it wears a material, not a bare texture')
  assert.equal(Math.round(faceNormalY(lit[0])), 1, 'facing the room, not the wall')

  // The piece is the panel and nothing above it: the hung board is the same panel plus
  // two rods and their two ceiling plates, so five meshes fewer is exactly "there is no
  // suspension".
  const hung = buildSignMeshes({ front: FRONT, back: BACK })
  assert.equal(hung.meshes.length - wall.meshes.length, 5, 'the wall board carries no rods')

  // It is bolted **on** the wall: the piece's own back face is the wall's plane (the
  // cell's −y edge, local y = −0.5), so no part of the body floats in front of it, and
  // its panel sits at the reading height `SIGN_WALL_PANEL_Z` names rather than filling
  // the storey. The group is placed at the cell centre and the block top, so the cell's
  // −y edge is y = 3 and the floor top is z = 1.
  const mm = (n) => Math.round(n * 1000) / 1000
  const wallBox = new THREE.Box3().setFromObject(wall.group)
  const hungBox = new THREE.Box3().setFromObject(hung.group)
  assert.equal(mm(wallBox.min.y), 3, 'the body’s back face is the wall plane')
  assert.ok(wallBox.max.y - wallBox.min.y < 0.25, `and its own body is the only thing proud of it (${(wallBox.max.y - wallBox.min.y).toFixed(3)} m)`)
  assert.equal(mm(wallBox.min.z - 1), mm(SIGN_WALL_PANEL_Z - PANEL_MIN_H / 2), 'the panel’s foot is the course line its backing rule asks from')
  assert.equal(mm(wallBox.max.z - 1), mm(SIGN_WALL_PANEL_Z + PANEL_MIN_H / 2), 'and its head the next one')
  assert.ok(Math.abs(hungBox.max.z - 4) < 0.06, 'the hung board still reaches the ceiling its rods bolt to')
  // The two mounts are one board: the panel is the same size either way.
  assert.equal(mm(wallBox.max.x - wallBox.min.x), mm(hungBox.max.x - hungBox.min.x), 'the same board, hung the other way')
})

test('a wall sign is cut to the face it mounts, never to a back it never prints', () => {
  // A wall board has the wall behind it, so 背面 is not mounted — and a **back the
  // document still carries** (an imported or hand-written save's) must therefore not be
  // mounted, printed or *sized*: the panel is the pair's wider face, so a long back would
  // otherwise cut the piece to a board that is not on it and centre 正面 on that steel.
  // `mountedSignBoards` is the one place that answers it.
  const longBack = [{ id: 'b1', kind: 'text', text: '往文冲方向的长目的地，请从B口出站换乘公交', x: 0.27, y: 0.35, scale: 1, side: 'both' }]
  const withBack = buildSignMeshes({ front: FRONT, back: longBack }, 'sign-wall')
  const frontOnly = buildSignMeshes({ front: FRONT, back: [] }, 'sign-wall')
  assert.deepEqual(withBack.plates.map((p) => p.face), ['left'], 'the wall board still mounts 正面 alone')
  assert.equal(
    withBack.plates[0].canvas.width,
    frontOnly.plates[0].canvas.width,
    'the panel is the front’s own, not the wider pair’s',
  )
  const width = (r) => Math.round(new THREE.Box3().setFromObject(r.group).max.x * 1000)
  assert.equal(width(withBack), width(frontOnly), 'and the drawn body is that panel wide either way')
  // The hung board is the pair's, as it always was: it really does mount both faces.
  const hung = buildSignMeshes({ front: FRONT, back: longBack })
  assert.deepEqual(hung.plates.map((p) => p.face), ['left', 'right'], 'the hung board still mounts both')
  assert.ok(hung.plates[0].canvas.width > frontOnly.plates[0].canvas.width, 'and is cut to the longer of the two')
})
