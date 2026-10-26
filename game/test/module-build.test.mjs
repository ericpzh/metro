import { trackTrainCentreV } from '../src/sim/track.ts'
import { TRACK_UNDERFLOOR_DROP, TRACK_BED_DROP, CONTACT_STRIP_Z, CONTACT_WIRE_Z } from '../src/sim/constants.ts'
// Every piece the station can draw, and the handles the scene animates it by.
//
// The module builders are the largest part of the renderer with no test of their
// own: a piece that silently draws nothing, half its parts, or the wrong size looks
// exactly like a slow frame, and nothing in the suite fails. `room-model`,
// `booth-model`, `tv-screen` and `tv-pair` pin their own pieces in detail; this file
// is the **coverage of the rest** — one row per palette piece, built through the real
// dispatcher and the real material kit, checking what it draws:
//
//   * the size it draws (metres, to the millimetre) and how many meshes it takes, so
//     a dropped part, a whole piece that stops being drawn, or one that stops being
//     instanced is a failure and not a silent hole in the station;
//   * the `userData` handles the scene animates a piece by (`wing`, `doors`,
//     `liftCabin`, `escalator`, `adScreen`, `wall`, …) — a piece that loses one stops
//     moving, and nothing throws;
//   * the dimensions that are **contracts with the sim**, not art: the 闸机's 1250 mm,
//     a screen door drawn to the height the graph reserves (`PSD_FULL_HEIGHT` /
//     `PSD_HALF_HEIGHT`), an exit that widens exactly one block per bay, a stair that
//     climbs `STAIR_RISE` over `STAIR_RUN`, a 2 m run that spans two cells;
//   * the consist: `cars × carLength` of body, both ends cabs, one leaf per modelled
//     door, and which end lights white;
//   * the four per-frame setters (`setGateWing`, `setDoors`, `setDoorsSides`,
//     `rollEscalator`), which are the only code that moves a piece already placed.
//
// A row that changes is not automatically a bug — it is a picture of the station
// changing, which is what the player would see too.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

/**
 * A 2D context just real enough for the model kit: style properties remember what
 * they are set to, and `measureText` answers with a width — several builders lay text
 * out from it, so returning nothing stops the build outright.
 */
function stubContext() {
  const store = {}
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (text) => ({ width: String(text ?? '').length * 8 })
      if (key === 'canvas') return stubCanvas()
      return () => undefined
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}
const stubCanvas = () => ({ width: 0, height: 0, getContext: () => stubContext() })
globalThis.document = { createElement: () => stubCanvas() }

// The kit and the dispatcher are imported after the DOM stub, the way the scene
// imports them behind a browser: `createModelMaterials` prints its textures at once.
const { buildModule, buildTrain, createModelMaterials, disposeObject, setDoors, setDoorsSides, setGateWing, rollEscalator } = await import('../src/render/models.ts')
const { createModule } = await import('../src/build/model.ts')
const { STOCK, doorCentres, doorWidthAt } = await import('../src/sim/stock.ts')
const { trainOriginForScale, trainScaleForStorey } = await import('../src/sim/stock.ts')
const { STAIR_RISE, STAIR_RUN, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_NARROW, STAIR_WIDTH_TRIPLE, stairFlights, stairRight, stairTurnCells } = await import('../src/sim/stairs.ts')
const { LIFT_STEP, LIFT_RISE, liftExtendedUp, liftLandingRows, liftModule, liftWithDoorSide } = await import('../src/sim/lifts.ts')
const { ESCALATOR_SPEED, ESCALATOR_BALUSTRADE, ESCALATOR_SURFACE_CLEARANCE, ESCALATOR_BASE_BURY, HALF_WALL_T, PSD_FULL_HEIGHT, PSD_HALF_HEIGHT, PSD_FULL_DOOR_WIDTH_SCALE, STAIR_RAIL_PROUD } = await import('../src/sim/constants.ts')
const { RAMP_FOOT } = await import('../src/sim/openings.ts')
const { DOOR_SPECS } = await import('../src/sim/doors.ts')
const { TrainSystem } = await import('../src/render/scene/systems/TrainSystem.ts')
const { LiftSystem } = await import('../src/render/scene/systems/LiftSystem.ts')
const { exitHeaderCanvas } = await import('../src/render/models/pieces/ExitModel.ts')

test('wide 地面 exit headers keep their text size and fill the full red background', () => {
  const drawHeader = (width) => {
    const recorded = { fills: [], words: [] }
    const context = {
      fillStyle: '#000', font: '', textAlign: '', textBaseline: '',
      fillRect: (...args) => recorded.fills.push({ colour: context.fillStyle, args }),
      fillText: (text, x, y) => recorded.words.push({ text, x, y, font: context.font }),
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
    }
    const previousDocument = globalThis.document
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
    try {
      const canvas = exitHeaderCanvas('动物园', 'A口', '', width)
      return { canvas, ...recorded }
    } finally {
      globalThis.document = previousDocument
    }
  }

  const standard = drawHeader(512)
  const wide = drawHeader(1024)
  assert.equal(standard.fills[0].colour, '#c22f28')
  assert.deepEqual(standard.fills[0].args, [0, 0, 512, 96])
  assert.deepEqual(wide.fills[0].args, [0, 0, 1024, 96], 'the wider texture must not leave its unused half transparent/black')
  assert.equal(wide.canvas.width, 1024)
  assert.deepEqual(wide.words.map(({ text, font }) => [text, font]), standard.words.map(({ text, font }) => [text, font]), 'wider bays add spacing without enlarging text')
  assert.equal(standard.words.find(({ text }) => text === '动物园站').x, 280)
  assert.equal(wide.words.find(({ text }) => text === '动物园站').x, 536)
  assert.equal(standard.words.find(({ text }) => text === 'A').x, 427)
  assert.equal(wide.words.find(({ text }) => text === 'A').x, 939)
})

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#c8102e',
  stock: 'B',
  modelScale: .98,
  cars: 6,
  power: 'third-rail',
  psd: 'full',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420,
  terminus: 'through',
  direction: 'up',
  upTerminus: '文冲',
  downTerminus: '滘口',
  travelSign: 1,
  stations: [],
}

/**
 * The ad-artwork surface a 广告牌 / 电视 prints through, cut down to a lit pane: the
 * real module resolves its WebPs with Vite's `import.meta.glob`, which plain Node has
 * no implementation of. Nothing under test lives there.
 */
const adsStub = {
  adFace: (slug, w, h) => ({ material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }), geometry: new THREE.PlaneGeometry(w, h), slug }),
  adWindow: (w, h) => adsStub.adFace('metro-security', w, h),
  load: async () => {},
  dispose: () => {},
}

/** A 5 × 4 room footprint with its own perimeter wall columns — what a room draws. */
function roomCells(w = 5, h = 4) {
  const out = []
  for (let x = 4; x < 4 + w; x++) {
    for (let y = 4; y < 4 + h; y++) {
      out.push({ x, y, z: 0, fill: 'solid' })
      if (x !== 4 && x !== 4 + w - 1 && y !== 4 && y !== 4 + h - 1) continue
      for (let dz = 1; dz <= 3; dz++) out.push({ x, y, z: dz, fill: 'solid' })
    }
  }
  return out
}

const mats = createModelMaterials()
// The document the builders read: one line, and the room footprint a room needs.
// Every other piece draws from its own module alone.
let data = { name: '动物园', seed: 7654321, cells: roomCells(), modules: [], lines: [LINE] }
const ctx = {
  mats,
  ads: adsStub,
  data,
  trackCells: new Set(),
  tvPlate: () => new THREE.CanvasTexture(stubCanvas()),
  signFace: () => new THREE.MeshBasicMaterial(),
  finish: () => mats.steel,
  preview: false,
  ownedMats: [],
}

const round = (n) => Math.round(n * 1000) / 1000
const dims = (size) => size.split('×').map(Number)
const box = (group) => {
  group.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(group)
}
const sizeOf = (group) => {
  const s = box(group).getSize(new THREE.Vector3())
  return `${round(s.x)}×${round(s.y)}×${round(s.z)}`
}

/** Build one module the way the scene does, and measure what came back. */
function build(mod, preview = false) {
  ctx.data = data = { ...data, modules: [mod] }
  ctx.preview = preview
  const group = buildModule(mod, ctx)
  ctx.preview = false
  if (!group) return null
  let meshes = 0
  let instanced = 0
  const groupKeys = new Set(Object.keys(group.userData ?? {}))
  const meshKeys = new Set()
  group.traverse((o) => {
    if (!o.isMesh) return
    meshes++
    if (o.isInstancedMesh) instanced++
    for (const k of Object.keys(o.userData ?? {})) meshKeys.add(k)
  })
  return { group, meshes, instanced, size: sizeOf(group), groupKeys, meshKeys }
}

const palette = (id, rot = 0, dir = 'up', door = 'lane', at = [4, 4, 0]) => createModule(id, at[0], at[1], at[2], 'm-' + id, rot, undefined, dir, door, [LINE])

test('escalator newel lights show entry arrows and exit bars facing their landings', () => {
  for (const width of [1, 2, 3]) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const { group } = build(createModule('escalator', 4, 4, 0, 'lights', rot, width, dir))
    group.updateMatrixWorld(true)
    const lights = []
    group.traverse((o) => { if (o.name === 'escalator-indicator') lights.push(o) })
    assert.equal(lights.length, 4, 'a light on each newel at both landings')
    const entry = lights.filter((o) => o.userData.indication === 'entry')
    const stop = lights.filter((o) => o.userData.indication === 'stop')
    assert.equal(entry.length, 2)
    assert.equal(stop.length, 2)
    const entryCentre = entry[0].getWorldPosition(new THREE.Vector3())
    const exitCentre = stop[0].getWorldPosition(new THREE.Vector3())
    assert.equal(Math.sign(exitCentre.z - entryCentre.z), dir === 'up' ? 1 : -1,
      'up enters below and stops above; down reverses the landing lights')
    const travel = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion)
    travel.z = 0
    travel.normalize()
    for (const light of lights) {
      const isEntry = light.userData.indication === 'entry'
      const symbol = light.getObjectByName(isEntry ? 'entry-arrow' : 'stop-bar')
      assert.ok(symbol)
      assert.equal(symbol.material, isEntry ? mats.ledGreen : mats.ledRed)
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(symbol.getWorldQuaternion(new THREE.Quaternion()))
      assert.ok(facing.dot(travel) * (isEntry ? -1 : 1) > 0.999, 'light faces the approaching passenger')
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(symbol.getWorldQuaternion(new THREE.Quaternion()))
      assert.ok(up.z > 0.8, 'arrow points upward on the display at every rotation')
    }
  }
})

test('a wider escalator has one continuous moving band and only two outer balustrades', () => {
  for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const narrow = build(createModule('escalator', 4, 4, 0, 'narrow', rot, 1, dir))
    for (const width of [2, 3]) {
      const wide = build(createModule('escalator', 4, 4, 0, 'wide', rot, width, dir))
      assert.equal(wide.meshes, narrow.meshes, 'widening adds no second escalator or centre rails')
      let bands = 0
      let glass = 0
      wide.group.traverse((o) => {
        if (o.userData.escalator) bands++
        if (o.isMesh && o.material === mats.glass) glass++
      })
      assert.equal(bands, 1)
      assert.equal(glass, 2, 'glass only at the outer edges')
      const part = wide.group.userData.escalator.parts[0]
      part.geometry.computeBoundingBox()
      assert.equal(round(part.geometry.boundingBox.max.y - part.geometry.boundingBox.min.y), 0.52 + (width - 1), 'the broader shoulders narrow the moving band by 8 cm per side')
      const bounds = box(wide.group)
      const size = bounds.getSize(new THREE.Vector3())
      assert.equal(round(rot % 2 === 0 ? size.x : size.y), width, 'landing aprons fit exactly inside the plan blocks')
      rollEscalator(wide.group.userData.escalator, 2)
      assert.ok(wide.group.userData.escalator.phase > 0)
    }
  }
})

test('double- and triple-storey escalators draw every plan width', () => {
  for (const span of ['double', 'triple']) for (const width of [2, 3]) {
    const mod = createModule('escalator', 4, 4, 0, `${span}-${width}`, 0, width, 'up', 'lane', [], undefined, {
      escalatorSpan: span, doubleRampLength: 'long', tripleRampLength: 'long',
    })
    const { group } = build(mod)
    const size = box(group).getSize(new THREE.Vector3())
    assert.equal(round(size.x), width, `${span} width ${width} draws its block span`)
    let bands = 0
    let glass = 0
    group.traverse((o) => {
      if (o.userData.escalator) bands++
      if (o.isMesh && o.material === mats.glass) glass++
    })
    assert.equal(bands, 1, `${span} width ${width} keeps one moving band`)
    assert.equal(glass, 2, `${span} width ${width} keeps two outer balustrades`)
    const part = group.userData.escalator.parts[0]
    part.geometry.computeBoundingBox()
    assert.equal(round(part.geometry.boundingBox.max.y - part.geometry.boundingBox.min.y), 0.52 + (width - 1))
  }
})

test('escalator glass fills the rounded handrail returns at both ends', () => {
  for (const width of [1, 2, 3]) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const mod = createModule('escalator', 4, 4, 0, 'glass-ends', rot, width, dir)
    const { group } = build(mod)
    const panes = group.children.filter((o) => o.material === mats.glass)
    assert.equal(panes.length, 2, 'each outer side has one seamless glass pane')
    const len = group.children.find((o) => o.name === 'truss').geometry.parameters.width
    for (const pane of panes) {
      pane.geometry.computeBoundingBox()
      const bounds = pane.geometry.boundingBox
      assert.equal(round(bounds.min.x), -0.5, 'glass reaches the centre of the starting rounded return')
      assert.equal(round(bounds.max.x), round(len + 0.5), 'glass reaches the centre of the other return')
      assert.equal(round(bounds.min.z), 0)
      assert.equal(round(bounds.max.z), 1)
      const positions = pane.geometry.attributes.position
      let left = 0, right = 0
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i)
        if (x >= 0 && x <= len) continue
        const endX = x < 0 ? 0 : len
        assert.ok((x - endX) ** 2 + (z - 0.5) ** 2 <= 0.25 + 1e-6,
          'rounded infill stays within the handrail curve instead of adding square corners')
        if (x < -0.49) left++
        if (x > len + 0.49) right++
      }
      assert.ok(left > 0 && right > 0, 'both previously empty ends carry glass')
    }
  }
})

test('escalator steps flatten smoothly at both combs and wrap while hidden', () => {
  for (const width of [1, 2, 3]) for (const dir of ['up', 'down']) {
    const { group } = build(createModule('escalator', 4, 4, 0, 'terminal', 0, width, dir))
    const roll = group.userData.escalator
    const matrix = new THREE.Matrix4()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    let lowerFlat = false
    let upperFlat = false
    let partialRiser = false
    let hidden = false
    for (let frame = 0; frame < 64; frame++) {
      rollEscalator(roll, 0.07)
      for (let i = 0; i < roll.count; i++) {
        roll.parts[0].getMatrixAt(i, matrix)
        matrix.decompose(position, rotation, scale)
        if (matrix.getMaxScaleOnAxis() < 0.01) { hidden = true; continue }
        assert.ok(position.z >= 0.015 - 1e-5 && position.z <= 5.015 + 1e-5, 'no tread leaps above a landing')
        if (Math.abs(position.z - 0.015) < 1e-5) lowerFlat = true
        if (Math.abs(position.z - 5.015) < 1e-5) upperFlat = true
        roll.risers.getMatrixAt(i, matrix)
        matrix.decompose(position, rotation, scale)
        const riserScale = Math.abs(matrix.elements[10])
        assert.ok(riserScale <= 1.001, 'no terminal step keeps an oversized riser')
        if (riserScale < 1e-6) assert.ok(matrix.getMaxScaleOnAxis() < 1e-6, 'a collapsed riser disappears completely instead of leaving a flat strip past the comb')
        if (riserScale > 0.01 && riserScale < 0.99) partialRiser = true
      }
    }
    assert.ok(lowerFlat && upperFlat, 'both ends carry level steps')
    assert.ok(partialRiser, 'risers shrink gradually through the bend')
    assert.ok(hidden, 'step return is covered by the fixed combs')
    const skirts = []
    group.traverse((o) => { if (o.name === 'side-skirt') skirts.push(o) })
    assert.equal(skirts.length, 2)
    for (const skirt of skirts) {
      assert.equal(round(skirt.geometry.parameters.height), 0.18, 'the metal shoulder is three times its former 6 cm width')
    }
  }
})

test('escalator landing aprons sit above floor caps, with no coplanar top faces', () => {
  for (let rot = 0; rot < 4; rot++) for (const width of [1, 2, 3]) for (const dir of ['up', 'down']) {
    const mod = createModule('escalator', 4, 4, 0, 'clearance', rot, width, dir)
    const { group } = build(mod)
    const tops = []
    group.traverse((o) => { if (o.name === 'landing-deck') tops.push(box(o).max.z) })
    assert.deepEqual(tops.sort((a, b) => a - b).map(round), [1 + ESCALATOR_SURFACE_CLEARANCE, 6 + ESCALATOR_SURFACE_CLEARANCE], 'both metal aprons clear their floor by 5 mm')
  }
})
/**
 * A 站名 is cut from the **station's name**, not from its palette id, so it is
 * built through the whole document (`data.name` is 动物园 here): its panel is three
 * cells wide for a three-character name, which is the number the row below pins.
 */
const calligraphy = (id) => createModule(id, 4, 4, 0, 'm-' + id, 0, undefined, 'up', 'lane', data)
const room = (type, kind, extra = {}) => ({ id: `${type}-1`, type, x: 4, y: 4, z: 0, w: 5, h: 4, rot: 0, cfg: { kind, door: [[6, 4]], ...extra } })
const edge = (psd, side = 'left', dir = 'up') => ({ id: `edge-${psd}`, type: 'platform-edge', x: 4, y: 4, z: 0, w: 8, rot: 0, cfg: { name: '站台门', line: '5', dir, side, psd, from: 'track-1' } })

test('PSD station plaques and yellow lights stay centred over door openings on either bank', () => {
  for (const side of ['left', 'right']) for (const dir of ['up', 'down']) {
    const group = build({ ...edge('full', side, dir), w: 24 }).group
    const plaques = group.children.filter(o => o.name === 'psd-station-header')
    const lights = group.children.filter(o => o.name === 'psd-station-light')
    const leaves = group.userData.doors.filter(o => o.name === 'psd-door-glass')
    assert.ok(plaques.length > 1, 'station/route alternation recurs along the screen')
    assert.equal(plaques.length, leaves.length / 2)
    assert.equal(lights.length, plaques.length)
    for (let i = 0; i < plaques.length; i++) {
      assert.ok(Math.abs(plaques[i].position.x - (leaves[2*i].position.x + leaves[2*i+1].position.x) / 2) < 1e-6)
      assert.equal(lights[i].position.x, plaques[i].position.x)
      assert.ok(lights[i].position.z < plaques[i].position.z, 'yellow light sits below the station ink')
      assert.equal(lights[i].geometry.type, 'SphereGeometry', 'indicator is a raised oval lens')
      assert.equal(round(lights[i].scale.x * 2), 0.15, 'lens is 15 cm wide')
      assert.equal(round(lights[i].scale.z * 2), 0.064, 'lens is 6.4 cm tall')
      assert.equal(round(plaques[i].geometry.parameters.height), 0.6, 'header is 60 cm tall')
      assert.equal(round(leaves[0].geometry.parameters.height), 2.35, 'door glass meets the header without a gap')
      assert.equal(plaques[i].material.side, THREE.FrontSide)
    }
  }
})
test('D platform openings match the narrow end doors and wider paired passenger doors', () => {
  const line={...LINE,stock:'D',cars:8}
  for (const psd of ['half','full']) {
    const mod={...edge(psd),w:161}
    const group=buildModule(mod,{...ctx,data:{...data,lines:[line],modules:[mod]}})
    const leaves=group.userData.doors.filter(o=>o.name==='psd-door-glass')
    const centres=doorCentres(line)
    assert.equal(leaves.length,centres.length*2)
    for (let i=0;i<centres.length;i++) {
      const centre=(leaves[i*2].position.x+leaves[i*2+1].position.x)/2+0.5-mod.w/2
      assert.ok(Math.abs(centre-centres[i])<1e-6,'screen opening keeps the train door centre')
      const scale=psd==='half'?1:PSD_FULL_DOOR_WIDTH_SCALE
      const expected=doorWidthAt(line,centres[i])*scale/2 + 0.20
      assert.ok(Math.abs(leaves[i*2].geometry.parameters.width-expected)<1e-6,'each screen opening uses its matching train doorway width')
    }
    disposeObject(group)
  }
})
const track = (cfg) => ({ id: 'track-1', type: 'track', x: 4, y: 4, z: 0, w: 8, d: 3, rot: 0, cfg: { line: '5', power: 'third-rail', dir: 'up', ...cfg } })

/**
 * One row per piece: the label, the module, the meshes it draws and the size its
 * bounding box spans in metres. The count is exact on purpose — a part that stops
 * being built is invisible in every other way.
 */
const PIECES = [
  ['闸机 lane', palette('gate'), 33, '1×0.944×1.02'],
    ['闸机 fence', palette('gate', 0, 'up', 'fence'), 45, '1.015×0.944×1.02'],
    ['玻璃围栏', palette('fence'), 18, '1.03×0.11×0.999'],
  ['售票机', palette('tvm'), 32, '0.74×0.671×1.84'],
  ['自动售货机', palette('vending'), 58, '0.78×0.701×1.88'],
  ['座椅 不锈钢 1 m', palette('bench-steel-1'), 7, '0.9×0.415×0.49'],
  ['座椅 不锈钢 2 m', palette('bench-steel-2'), 7, '1.9×0.415×0.49'],
  ['座椅 靠背 1 m', palette('bench-seat-1'), 13, '1.04×0.685×1.105'],
  ['座椅 连排 2 m', palette('bench-seat-2'), 21, '2.04×0.685×1.105'],
  ['货架', palette('shelf'), 25, '0.96×0.5×1.9'],
  ['办公桌', palette('desk'), 56, '0.98×0.965×1.22'],
  ['收银台', palette('checkout'), 35, '0.98×0.878×1.393'],
  ['厕所隔间', palette('cubicle'), 31, '1.07×1.064×1.978'],
  ['洗手池', palette('sink'), 16, '0.689×0.585×1.042'],
  ['垃圾桶', palette('bin'), 28, '0.88×0.42×0.95'],
  ['灭火器', palette('extinguisher'), 13, '0.743×0.487×1.1'],
  ['时钟', palette('clock'), 131, '0.8×0.236×1.05'],
  ['监控 枪机', palette('cctv'), 24, '0.31×0.369×0.48'],
  ['灯具 圆形', palette('light-circular'), 2, '0.5×0.5×0.08'],
  ['灯具 直条', palette('light-rectangular'), 2, '0.8×0.12×0.08'],
  ['通风口', palette('vent'), 14, '0.7×0.7×0.06'],
  ['导向柱', palette('guidepost'), 17, '0.16×0.589×4'],
  // A 公交站's displays carry a black frame and a poster plate **per face**, and the route
  // cabinet adds an upright panel on its back — so the two rows below are two meshes per
  // lightbox face plus two for the upright one (21 and 30 before the back faces existed).
  // Every face mounts the shared `adArt` quad: one plate each, no duplicated geometry.
  ['公交站 短版', palette('busstop-short'), 25, '3.88×1.88×3'],
  ['公交站 长版', palette('busstop-long'), 36, '7.88×1.88×3'],
  ['广告牌 横版', palette('billboard-wide'), 5, '0.98×0.185×0.86'],
  ['广告牌 标准', palette('billboard-standard'), 5, '1.84×0.185×1.14'],
  ['广告牌 大横版', palette('billboard-large'), 5, '1.98×0.185×1.33'],
  ['广告牌 长幅', palette('billboard-panorama'), 5, '2.94×0.185×1.13'],
  ['广告牌 竖版', palette('billboard-portrait'), 5, '0.92×0.185×1.54'],
  ['广告牌 方形', palette('billboard-square'), 5, '0.92×0.185×1.18'],
  ['电视', palette('tv'), 12, '1.56×0.16×1.32'],
  ['指示牌 吊挂', palette('sign-ceiling'), 7, '1.9×0.16×0.85'],
  ['指示牌 墙面', palette('sign-wall'), 1, '1.9×0×0.4'],
  // The wall pieces (§5.7). A 玻璃板 is the outer frame and one pane whatever its
  // size — five meshes for a 1 × 1 band and for a 3 × 2 window alike, which is what
  // "no inner frame" means as a number. A 站名 is its single ink plane, cut to the
  // panel the name asked for. A 线网图 is a framed board, or a totem with a plinth, a
  // post and a lit face on each side — the **same two-cell board** on both mounts.
  ['玻璃板 1×1', palette('glass-1x1'), 5, '1×0.1×1'],
  ['玻璃板 3×1', palette('glass-3x1'), 5, '3×0.1×1'],
  ['玻璃板 3×2', palette('glass-3x2'), 5, '3×0.1×2'],
  // The 门 (§5.7) is a free-standing doorway. Stainless now includes exposed hardware;
  // wood retains its simpler pull and kick plate.
  ['门 不锈钢 窄', palette('door-steel-1'), 20, '1×0.19×1.99'],
  ['门 木 窄', palette('door-wood-1'), 12, '1×0.19×1.99'],
  ['站名 楷书 横排', calligraphy('calligraphy-kai-h'), 1, '3×0×1'],
  ['站名 楷书 竖排', calligraphy('calligraphy-kai-v'), 1, '0.98×0×2.6'],
  ['线网图 墙面', palette('linemap-wall'), 3, '1.92×0.185×1.94'],
  ['线网图 立式', palette('linemap-stand'), 5, '1.86×0.62×2.28'],
  ['出入口 有盖 单向', palette('exit-covered-1'), 76, '3.1×8.118×4'],
  ['出入口 有盖 双向', palette('exit'), 76, '4.1×8.118×4'],
  ['出入口 有盖 三向', palette('exit-covered-3'), 76, '5.1×8.118×4'],
  ['出入口 无盖 单向', palette('exit-uncovered-1'), 45, '3.04×8.08×1.25'],
  ['出入口 无盖 双向', palette('exit-uncovered-2'), 47, '4.04×8.08×1.25'],
  ['出入口 无盖 三向', palette('exit-uncovered-3'), 47, '5.04×8.08×1.25'],
  ['出入口 地面 单向', palette('exit-doorway-1'), 3, '3×0.072×0.78'],
  ['出入口 地面 双向', palette('exit-doorway-2'), 3, '4×0.072×0.78'],
  ['出入口 地面 三向', palette('exit-doorway-3'), 3, '5×0.072×0.78'],
  ['出入口 地面 四向', palette('exit-doorway-4'), 3, '6×0.072×0.78'],
  ['出入口 虚拟', palette('exit-virtual'), 17, '0.16×0.589×4'],
  ['扶梯', palette('escalator'), 33, '1×10.325×6.552'],
  ['电梯', palette('lift'), 148, '2.04×2.04×5'],
  // The 楼梯 pieces stand in the corner of the fixture's walled room, so the wall columns
  // around them are read: a flight or half-landing a wall hugs loses that side's balustrade
  // (`stairWallSides` / `stairLandingWalls`). In the open, a 90° turn draws 90 meshes and a
  // 双跑楼梯 93 — the rows below are the same pieces with a room's wall against the turn.
  // A turning leg is built block-wide (`stairBuildWidth`), so a 90° turn's box reaches the
  // corner cell's own edge on the open side, just as a 双跑楼梯's does.
  //
  // The height is the stringer's and soffit's **square-cut corners**, not an overhang: both
  // beams are trimmed by `thickness · tan θ` so they end on the treads' own edge, inside the
  // cell the cut shaves. An overhang put the piece's lowest point 0.36 m deep in the landing's
  // block, which is deliberately never cut — the flight's foot sank into the floor it stands on.
  ['楼梯 单跑', palette('stair-straight'), 91, '1×8.25×6.32'],
  ['楼梯 左转 90°', palette('stair-left90'), 116, '4.625×4.625×6.313'],
  ['楼梯 右转 90°', palette('stair-right90'), 116, '4.625×4.625×6.313'],
  ['楼梯 左双跑', palette('stair-left180'), 120, '2×4.655×6.313'],
  ['楼梯 右双跑', palette('stair-right180'), 120, '2×4.655×6.313'],
  ['售票亭', { id: 'booth-1', type: 'booth', x: 4, y: 4, z: 0, w: 3, h: 3, rot: 0, cfg: { kind: 'ticket' } }, 33, '3×3×2.4'],
  ['商店房间', room('shop', 'store'), 18, '5×4×3'],
  // 厕所 / 办公室 close their doorway with the shared 门 builder
  // (`render/models/pieces/DoorModel.ts`): the same standing doorway — threshold, posts,
  // head and the leaf between them — set into the opening they cut, so the room's box
  // grows by the threshold's own step past the wall's face and nothing more.
  ['厕所房间', room('shop', 'toilet'), 38, '5×4.09×3'],
  ['办公室房间', room('shop', 'office'), 38, '5×4.09×3'],
  ['零售外壳', room('retail', undefined), 18, '5×4×3'],
]

test('every piece the palette can lay draws a model, at the size it draws it', () => {
  for (const [label, mod, meshes, size] of PIECES) {
    const built = build(mod)
    assert.ok(built, `${label}: the dispatcher drew nothing at all`)
    assert.ok(built.meshes > 0, `${label}: a piece with no mesh is invisible in the station`)
    assert.equal(built.meshes, meshes, `${label}: mesh count`)
    assert.equal(built.size, size, `${label}: bounding box (x×y×z metres)`)
  }
})

test('bridge noise barrier panels and rails meet posts without overlapping exposed faces', () => {
  for (const railing of ['sound-barrier', 'sound-barrier-half']) {
    for (const power of ['catenary', 'third-rail']) {
      for (const w of [8, 17]) {
        for (const rot of [0, 1, 2, 3]) {
          const mod = { ...track({ bridge: true, power, bridgeRailing: railing }), w, rot }
          const group = build(mod).group
          const parts = []
          group.traverse((o) => {
            if (o.isMesh && (o.name.startsWith('bridge-barrier-') || o.name === 'bridge-gantry-post' || o.name === 'bridge-edge-concrete')) {
              parts.push({ name: o.name, box: new THREE.Box3().setFromObject(o) })
            }
          })
          assert.ok(parts.some((p) => p.name === 'bridge-barrier-glass'), 'the barrier retains its clear upper panels')
          const label = `${railing}, ${power}, ${w} m, rotation ${rot}`
          for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
              const a = parts[i].box
              const b = parts[j].box
              const axes = ['x', 'y', 'z']
              const overlap = axes.map((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]))
              assert.ok(!overlap.every((n) => n > 1e-6), `${label}: ${parts[i].name} must not pass through ${parts[j].name}`)
              if ((parts[i].name === 'bridge-barrier-glass') !== (parts[j].name === 'bridge-barrier-glass')) {
                const separation = Math.max(...axes.flatMap((axis) => [a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]]))
                assert.ok(separation >= 0.003 - 1e-6,
                  `${label}: transparent glass needs 3 mm clearance from frame and gantry faces, including opposing faces`)
              }
              // Opposite faces may meet inside a butt joint. Faces pointing the
              // same way must never cover the same visible area (z-fighting).
              for (let k = 0; k < axes.length; k++) {
                if (!overlap.every((n, axis) => axis === k || n > 1e-6)) continue
                for (const face of ['min', 'max']) {
                  assert.ok(Math.abs(a[face][axes[k]] - b[face][axes[k]]) > 1e-6,
                    `${label}: ${parts[i].name} and ${parts[j].name} duplicate an exposed ${axes[k]} face`)
                }
              }
            }
          }
          disposeObject(group)
        }
      }
    }
  }
})

test('bridge barrier clears a neighbouring platform gantry at either end in every rotation', () => {
  const turn = (rot, x, y) => [[x, y], [-y, x], [-x, -y], [y, -x]][rot]
  for (const rot of [0, 1, 2, 3]) for (const end of ['start', 'end']) {
    for (const d of [3, 4]) for (const railing of ['sound-barrier', 'sound-barrier-half']) {
      const bridge = { ...track({ bridge: true, power: 'catenary', bridgeRailing: railing }), w: 16, d, rot }
      const [dx, dy] = turn(rot, end === 'end' ? bridge.w : -1, end === 'end' ? 0 : d - 1)
      const platform = { ...track({ power: 'catenary', catenaryStyle: 'gantry' }), id: 'platform-join',
        x: bridge.x + dx, y: bridge.y + dy, w: 16, d, rot: end === 'end' ? rot : (rot + 2) % 4 }
      const joinCtx = { ...ctx, data: { ...data, modules: [bridge, platform] } }
      const bridgeGroup = buildModule(bridge, joinCtx)
      const platformGroup = buildModule(platform, joinCtx)
      bridgeGroup.updateMatrixWorld(true)
      platformGroup.updateMatrixWorld(true)
      const barrier = [], posts = []
      bridgeGroup.traverse(o => { if (o.isMesh && (o.name.startsWith('bridge-barrier-') || o.name === 'bridge-edge-concrete')) barrier.push(o) })
      platformGroup.traverse(o => { if (o.isMesh && o.name === 'station-gantry-post') posts.push(o) })
      assert.equal(posts.length, 2, 'the platform draws one mast at each support position')
      for (const panel of barrier) for (const post of posts) {
        const a = new THREE.Box3().setFromObject(panel)
        const b = new THREE.Box3().setFromObject(post)
        const axes = ['x', 'y', 'z']
        const overlap = axes.map(axis => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]))
        const label = `${end}, rotation ${rot}, ${d} m, ${railing}: ${panel.name}`
        assert.ok(!overlap.every(n => n > 1e-6), `${label} must not penetrate the platform gantry`)
        if (panel.name === 'bridge-barrier-glass') {
          const separation = Math.max(...axes.flatMap(axis => [a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]]))
          assert.ok(separation >= 0.003 - 1e-6, `${label} keeps glazing clearance at the module seam`)
        }
      }
      // A canopy has no end upright: removing the neighbouring gantry must
      // restore the full barrier, rather than permanently shortening the bridge.
      const canopy = { ...platform, cfg: { ...platform.cfg, catenaryStyle: 'canopy' } }
      const noGantry = buildModule(bridge, { ...joinCtx, data: { ...joinCtx.data, modules: [bridge, canopy] } })
      noGantry.updateMatrixWorld(true)
      const bounds = new THREE.Box3()
      const local = noGantry.matrixWorld.clone().invert()
      noGantry.traverse(o => {
        if (o.isMesh && o.name.startsWith('bridge-barrier-')) {
          bounds.union(new THREE.Box3().setFromObject(o).applyMatrix4(local))
        }
      })
      assert.ok(Math.abs(bounds.min.x + 0.5) < 1e-6 && Math.abs(bounds.max.x - (bridge.w - 0.5)) < 1e-6,
        'a platform without a gantry does not clip either bridge barrier end')
      disposeObject(bridgeGroup)
      disposeObject(platformGroup)
      disposeObject(noGantry)
    }
  }
})

test('screen doors, bridge barriers, ground barriers and both gantries share the same side line', () => {
  const turn = (rot, x, y) => [[x, y], [-y, x], [-x, -y], [y, -x]][rot]
  for (const rot of [0, 1, 2, 3]) for (const d of [3, 4]) {
    const platform = { ...track({ power: 'catenary', catenaryStyle: 'gantry' }), w: 16, d, rot }
    const [bx, by] = turn(rot, -16, 0)
    const bridge = { ...platform, id: 'bridge-align', x: platform.x + bx, y: platform.y + by,
      cfg: { ...platform.cfg, bridge: true, bridgeRailing: 'sound-barrier' } }
    const edges = ['right', 'left'].map(side => {
      const [dx, dy] = turn(rot, 0, side === 'right' ? -1 : d)
      return { id: `edge-${side}`, type: 'platform-edge', x: platform.x + dx, y: platform.y + dy, z: platform.z,
        w: platform.w, rot, cfg: { line: '5', dir: 'up', from: platform.id, side, psd: 'half' } }
    })
    const context = { ...ctx, data: { ...data, lines: [{ ...LINE, stock: d === 4 ? 'D' : 'B' }], modules: [platform, bridge, ...edges] } }
    const [ax, ay] = turn(rot, 0, 1)
    const across = mesh => {
      const centre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3())
      return centre.x * ax + centre.y * ay
    }
    const screens = edges.map(edge => buildModule(edge, context))
    screens.forEach(screen => screen.updateMatrixWorld(true))
    const screenLines = screens.map(screen => across(screen.getObjectByName('psd-fixed-glass')))
    for (const barrier of ['railing', 'sound-barrier-half', 'sound-barrier']) {
      const candidate = { ...bridge, cfg: { ...bridge.cfg, bridgeRailing: barrier } }
      const group = buildModule(candidate, context)
      group.updateMatrixWorld(true)
      const actual = []
      group.traverse(o => {
        if (o.isMesh && (o.name.startsWith('bridge-barrier-') || o.name === 'bridge-railing-post' || o.name === 'bridge-gantry-post')) {
          const value = across(o)
          actual.push(value)
          assert.ok(screenLines.some(line => Math.abs(line - value) < 1e-6), `${barrier}: generated barriers and gantries continue the PSD line`)
        }
      })
      assert.ok(screenLines.every(line => actual.some(value => Math.abs(line - value) < 1e-6)), 'both bridge sides align')
      disposeObject(group)
    }
    const gantry = buildModule(platform, context)
    gantry.updateMatrixWorld(true)
    gantry.traverse(o => {
      if (o.name === 'station-gantry-post') assert.ok(screenLines.some(line => Math.abs(line - across(o)) < 1e-6), 'platform portal uprights sit on the PSD line')
    })
    for (let side = 0; side < edges.length; side++) {
      const edge = edges[side]
      for (const id of ['noise-barrier', 'noise-barrier-half', 'noise-barrier-railing']) {
        const mod = createModule(id, edge.x, edge.y, edge.z, id, (rot + (side === 0 ? 2 : 0)) % 4)
        const group = buildModule(mod, context)
        group.updateMatrixWorld(true)
        assert.ok(Math.abs(across(group) - screenLines[side]) < 1e-6, 'a placed barrier on the platform tile aligns with its screen door')
        disposeObject(group)
      }
    }
    disposeObject(gantry)
    screens.forEach(disposeObject)
  }
})

test('raised concrete bridge shoulders meet every sound barrier and railing footing', () => {
  for (const bridgeRailing of ['railing', 'sound-barrier-half', 'sound-barrier']) {
    for (const rot of [0, 1, 2, 3]) for (const power of ['third-rail', 'catenary']) {
      const mod = { ...track({ bridge: true, power, bridgeRailing }), w: 16, rot }
      const group = buildModule(mod, { ...ctx, data: { ...data, lines: [LINE], modules: [mod] } })
      group.updateMatrixWorld(true)
      const local = group.matrixWorld.clone().invert()
      const bounds = o => new THREE.Box3().setFromObject(o).applyMatrix4(local)
      const shoulders = [], feet = []
      group.traverse(o => {
        if (!o.isMesh) return
        if (o.name === 'bridge-edge-concrete') shoulders.push(bounds(o))
        if (o.name === 'bridge-barrier-lower-panel' || o.name === 'bridge-barrier-post' || o.name === 'bridge-railing-post') feet.push(bounds(o))
      })
      const top = bridgeRailing === 'railing' ? 0.55 : 0.5
      const scale = trainScaleForStorey()
      const bedTop = (0.45 - TRACK_BED_DROP) * scale + trainOriginForScale(scale) - (1 - 0.62) * scale
      assert.ok(shoulders.length >= 2, 'both bridge edges have raised concrete')
      for (const curb of shoulders) {
        assert.ok(Math.abs(curb.min.z - bedTop) < 1e-6 && Math.abs(curb.max.z - top) < 1e-6, 'concrete rises continuously from the recessed bed to the barrier footing')
        assert.ok(curb.max.y <= -0.5 + 1e-6 || curb.min.y >= (mod.d - 0.5) - 1e-6, 'raised concrete stays outside the rail bed and its drainage channels')
      }
      for (const foot of feet) {
        assert.ok(shoulders.some(curb => Math.abs(curb.max.z - foot.min.z) < 1e-6
          && Math.min(curb.max.x, foot.max.x) - Math.max(curb.min.x, foot.min.x) > 1e-6
          && Math.min(curb.max.y, foot.max.y) - Math.max(curb.min.y, foot.min.y) > 1e-6),
        `${bridgeRailing}, rotation ${rot}, ${power}: every panel and post stands on concrete without a gap`)
      }
      const deck = bounds(group.getObjectByName('bridge-deck'))
      assert.ok(Math.abs(deck.min.z + 1) < 1e-6 && Math.abs(deck.max.z - bedTop) < 1e-6, 'the recessed deck meets the scaled rail bed')
      disposeObject(group)
    }
  }
})

test('a hung piece hangs under the top block of its column, wherever it was aimed', () => {
  // `hungCeilingAim` puts every hanging item in the free cell under its column's **top block** —
  // `top block - 1` — and `hangCeilingLocal` mounts it at that cell's own top, so the block over it
  // *is* its ceiling. A piece that cell-for-cell sits one storey lower (an older save, or a column
  // with nothing over the floor) hangs from the same block the long way: the real slab overhead.
  const cells = [
    { x: 6, y: 6, z: 0, fill: 'solid' },
    { x: 6, y: 6, z: 4, fill: 'solid' }, // the slab over the room
  ]
  const previous = { ...ctx.data }
  try {
    data = { ...data, cells, modules: [] }
    for (const id of ['tv', 'sign-ceiling', 'clock', 'cctv', 'cctv-ptz', 'cctv-dome', 'monitor-ceiling', 'light-circular', 'vent']) {
      const mod = createModule(id, 6, 6, 0, 'm-' + id, 0, undefined, 'up', 'lane', [LINE])
      const fromFloor = box(build(mod).group)
      const fromTopBlock = box(build({ ...mod, z: 3 }).group)
      assert.ok(Math.abs(fromTopBlock.max.z - 4) < 0.02, `${id}: the mount sits on the top block`)
      assert.equal(round(fromTopBlock.min.z), round(fromFloor.min.z), `${id}: the same body, hanging from the cell under that block`)
    }
  } finally {
    ctx.data = data = previous
  }
})

test('left, centre and right forward stairs render both flights and the middle landing', () => {
  const previous = ctx.data
  try {
    for (const style of ['leftForward', 'centerForward', 'rightForward']) {
      for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]) {
        for (let rot = 0; rot < 4; rot++) {
          const mod = createModule(`stair-${style}`, 0, 0, 0, `forward-${style}-${width}-${rot}`, rot, width)
          ctx.data = { ...previous, cells: [], modules: [mod] }
          const group = buildModule(mod, ctx)
          assert.equal(group.children.length, 3, `${style}/${width}/${rot}: two flights and one landing`)
          for (const [index, flight] of group.children.slice(0, 2).entries()) {
            assert.ok(flight.children.some((part) => part.geometry?.type === 'BoxGeometry'),
              `${style}/${width}/${rot}: flight ${index} has visible treads`)
            assert.ok(flight.children.some((part) => part.material === mats.glass),
              `${style}/${width}/${rot}: flight ${index} has its rail glazing`)
          }
          const landing = group.children[2]
          assert.ok(landing.children.some((part) => part.geometry?.type === 'BoxGeometry'),
            `${style}/${width}/${rot}: middle landing is visible`)
        }
      }
    }
  } finally {
    ctx.data = previous
  }
})

test('extra-long stair landing rails meet flight tips and frames fill the landing', () => {
  const previous = ctx.data
  try {
    for (const style of ['left90', 'right90', 'left180', 'right180', 'leftForward', 'centerForward', 'rightForward']) {
      for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]) {
        for (let rot = 0; rot < 4; rot++) {
          const mod = createModule(`stair-${style}`, 0, 0, 0, 'joint', rot, width, 'up', 'lane', [], undefined, { rampLength: 'ultra-long' })
          ctx.data = { ...previous, cells: [], modules: [mod] }
          const group = buildModule(mod, ctx)
          group.updateMatrixWorld(true)
          const landing = group.children[2]
          const surface = box(landing.getObjectByName('stair-landing-surface'))
          const frame = box(landing.getObjectByName('stair-landing-frame'))
          for (const axis of ['x', 'y']) {
            assert.ok(Math.abs(surface.min[axis] - frame.min[axis]) < 1e-6)
            assert.ok(Math.abs(surface.max[axis] - frame.max[axis]) < 1e-6)
          }
          const rails = landing.children.filter(p => p.material === mats.handrail).map(box)
          for (const [i, flight] of group.children.slice(0, 2).entries()) {
            const f = stairFlights(mod)[i]
            const run = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y)
            for (const support of flight.children.filter(p => ['stair-stringer', 'stair-soffit'].includes(p.name))) {
              const positions = support.geometry.getAttribute('position')
              let atJoint = 0
              for (let v = 0; v < positions.count; v++) {
                const p = new THREE.Vector3().fromBufferAttribute(positions, v).applyMatrix4(support.matrix)
                if (Math.abs(p.x - (i === 0 ? run - 0.5 : 0.5)) < 1e-5) atJoint++
              }
              assert.ok(atJoint >= 12, `${style}: all support end corners meet a vertical landing plane`)
            }
            const tips = flight.children.filter(p => p.material === mats.handrail && Math.abs(p.rotation.y) > 0.01)
            assert.equal(tips.length, 2)
            for (const rail of tips) {
              const tip = new THREE.Vector3((i === 0 ? 1 : -1) * rail.geometry.parameters.width / 2, 0, 0)
              rail.localToWorld(tip)
              const other = group.children[1 - i].children.filter(p => p.material === mats.handrail).map(box)
              assert.ok([...rails, ...other].some(b => b.distanceToPoint(tip) < 0.04), `${style}/${width}/${rot}: rail tip ${tip.toArray()} meets landing (distances ${[...rails, ...other].map(b => b.distanceToPoint(tip))})`)
            }
          }
          disposeObject(group)
        }
      }
    }
  } finally { ctx.data = previous }
})

test('a 90° turn draws its quarter-landing as the square the sim lays', () => {
  // The drawn platform and the walkable floor are one rectangle, so the model must not invent
  // its own: it is the `lanes × lanes` **block square** the two perpendicular legs meet on
  // (`stairTurnCells`) — whole cells along the departing leg's run, the leg's band across it
  // and nothing more (the band's outer faces are its two balustrades, so the slab stops
  // `STAIR_RAIL_PROUD` short on those sides). A platform drawn a stair's width across (what a
  // quarter turn drew before) reaches half a block into the tiles beside it at 中 / 宽 and
  // leaves the landing cells the builder lays uncovered.
  const previous = ctx.data
  try {
    for (const [size, lanes] of [[STAIR_WIDTH_NARROW, 1], [STAIR_WIDTH_DOUBLE, 2], [STAIR_WIDTH_TRIPLE, 3]]) {
      for (const style of ['left90', 'right90']) {
        for (let rot = 0; rot < 4; rot++) {
          const mod = createModule(`stair-${style}`, 0, 0, 0, `${style}-${size}-${rot}`, rot, size)
          ctx.data = { ...previous, cells: [], modules: [mod] }
          const group = buildModule(mod, ctx)
          const where = `${style}/${size}/rot ${rot}`
          assert.equal(group.children.length, 3, `${where}: two flights and one landing`)
          // The block square, and the slab that must cover it: whole blocks along the run,
          // the band across.
          const cells = stairTurnCells(mod)
          const alongX = stairFlights(mod)[1].to.x !== stairFlights(mod)[1].from.x
          const span = (pick) => [Math.min(...cells.map(pick)), Math.max(...cells.map(pick)) + 1]
          const [alongLo, alongHi] = span((c) => (alongX ? c.x : c.y))
          const [acrossLo, acrossHi] = span((c) => (alongX ? c.y : c.x))
          const [lo, hi] = [acrossLo + STAIR_RAIL_PROUD, acrossHi - STAIR_RAIL_PROUD]
          const drawn = box(group.children[2].getObjectByName('stair-landing-surface'))
          const got = alongX ? [drawn.min.x, drawn.max.x, drawn.min.y, drawn.max.y] : [drawn.min.y, drawn.max.y, drawn.min.x, drawn.max.x]
          const want = [alongLo, alongHi, lo, hi]
          for (const [i, axis] of ['near', 'far', 'band near', 'band far'].entries()) {
            assert.ok(Math.abs(got[i] - want[i]) < 1e-6, `${where}: the platform's ${axis} edge is drawn at ${got[i]}, the sim lays ${want[i]}`)
          }
          assert.equal(new Set(cells.map((c) => c.x)).size, lanes, `${where}: the landing is not ${lanes} blocks across`)
          assert.equal(new Set(cells.map((c) => c.y)).size, lanes, `${where}: the landing is not ${lanes} blocks deep`)
          // Both legs still draw their own treads and rail glazing around that platform.
          for (const [index, flight] of group.children.slice(0, 2).entries()) {
            assert.ok(flight.children.some((part) => part.geometry?.type === 'BoxGeometry'), `${where}: flight ${index} has visible treads`)
            assert.ok(flight.children.some((part) => part.material === mats.glass), `${where}: flight ${index} has its rail glazing`)
          }
        }
      }
    }
  } finally {
    ctx.data = previous
  }
})

test('stair glass fills both sloped railings and landing returns around a continuous wide tread', () => {
  const previous = ctx.data
  try {
    for (const [width, treadWidth] of [[0.68, 0.79], [1.36, 1.79], [2.04, 2.79]]) {
      for (let rot = 0; rot < 4; rot++) {
        const mod = createModule('stair-straight', 0, 0, 0, 'stair', rot, width)
        ctx.data = { ...previous, cells: [], modules: [mod] }
        const group = buildModule(mod, ctx)
        const flight = group.children[0]
        const panes = flight.children.filter((o) => o.material === mats.glass)
        assert.equal(panes.length, 8, 'two sloping panels and two landing returns on each side')
        for (const pane of panes) {
          assert.ok(Math.abs(Math.abs(pane.position.y - 0.0125) - (treadWidth / 2 + 0.07)) < 1e-6,
            'all glass stays at the outer rails, with no divider in the stair centre')
          pane.geometry.computeBoundingBox()
          assert.ok(pane.geometry.boundingBox.getSize(new THREE.Vector3()).z > 0.5,
            'the glass fills the railing opening vertically')
        }
        const treads = flight.children.filter((o) => o.geometry.type === 'BoxGeometry'
          && Math.abs(o.geometry.parameters.depth - 0.09) < 1e-6)
        assert.equal(treads.length, 30, 'the full-width flight has one tread per step, without lane seams')
        for (const tread of treads) assert.ok(Math.abs(tread.geometry.parameters.height - treadWidth) < 1e-6)
      }
    }
  } finally {
    ctx.data = previous
  }
})

test('new medium and wide straight stairs shift from the hovered lane toward the run’s right side', () => {
  for (let rot = 0; rot < 4; rot++) {
    const narrow = createModule('stair-straight', 0, 0, 0, 'narrow', rot, STAIR_WIDTH_NARROW)
    const narrowFlight = build(narrow).group.children[0]
    const [rightX, rightY] = stairRight(rot)
    for (const [width, shift] of [[STAIR_WIDTH_DOUBLE, 0.5], [STAIR_WIDTH_TRIPLE, 1]]) {
      const wide = createModule('stair-straight', 0, 0, 0, `wide-${width}`, rot, width)
      const flight = build(wide).group.children[0]
      assert.ok(Math.abs(flight.position.x - narrowFlight.position.x - rightX * shift) < 1e-6,
        `width ${width}, rotation ${rot}: shift is ${shift} m along +stairRight`)
      assert.ok(Math.abs(flight.position.y - narrowFlight.position.y - rightY * shift) < 1e-6,
        `width ${width}, rotation ${rot}: preserve the same lateral anchor after rotation`)
      assert.equal(flight.position.z, narrowFlight.position.z, 'size changes do not move the flight vertically')
    }

    const legacy = createModule('stair-straight', 0, 0, 0, 'legacy', rot, 1.6)
    const legacyFlight = build(legacy).group.children[0]
    assert.ok(legacyFlight.position.distanceTo(narrowFlight.position) < 1e-6,
      'legacy off-grid width keeps its saved centre line')
  }
})

test('straight stairs fill their block edges with outer rails in every size and rotation', () => {
  const previous = ctx.data
  try {
    for (let rot = 0; rot < 4; rot++) {
      const [rx, ry] = stairRight(rot)
      for (const [width, blocks] of [[0.68, 1], [1.36, 2], [2.04, 3]]) {
        const mod = createModule('stair-straight', 0, 0, 0, 'stair', rot, width)
        ctx.data = { ...previous, cells: [], modules: [mod] }
        const group = buildModule(mod, ctx)
        const bounds = new THREE.Box3().setFromObject(group)
        const lo = rx ? bounds.min.x : bounds.min.y
        const hi = rx ? bounds.max.x : bounds.max.y
        const direction = rx || ry
        assert.ok(Math.abs(lo - (direction > 0 ? 0 : 1 - blocks)) < 1e-6,
          `size ${blocks}, rotation ${rot}: first outer rail meets the block edge`)
        assert.ok(Math.abs(hi - (direction > 0 ? blocks : 1)) < 1e-6,
          `size ${blocks}, rotation ${rot}: last outer rail meets the block edge`)
      }
    }
  } finally {
    ctx.data = previous
  }
})

test('the bin has an enclosed front and both hoppers face into their openings in every rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const { group, meshes, size } = build(palette('bin', rot))
    assert.equal(meshes, 28)
    assert.equal(size, rot % 2 ? '0.42×0.88×0.95' : '0.88×0.42×0.95')
    const ray = new THREE.Raycaster()
    const cast = (origin, direction) => {
      ray.set(group.localToWorld(new THREE.Vector3(...origin)), new THREE.Vector3(...direction).applyQuaternion(group.quaternion))
      return ray.intersectObject(group, true)[0]
    }
    assert.ok(cast([0, -0.5, 0.3], [0, 1, 0]), 'the lower front is a closed cabinet')
    for (const cx of [-0.2085, 0.2085]) {
      for (const [x, y] of [[cx, 0.12], [cx, -0.15], [cx - 0.17, 0], [cx + 0.17, 0]]) {
        const hit = cast([x, y, 1.1], [0, 0, -1])
        assert.ok(hit && hit.point.z > group.position.z + 0.755, 'each inclined hopper face is visible from the open mouth')
        assert.ok(hit.face.normal.z > 0, 'the hopper faces upward into the cavity, without backface gaps')
      }
      assert.equal(cast([cx, 0, 1.1], [0, 0, -1]).object.material, mats.black, 'the mouth stays open onto its recessed dark well')
    }
    const decal = group.children.find((mesh) => mesh.material === mats.binLabels)
    assert.equal(decal.geometry.parameters.height, 0.57, 'large sorting stickers occupy the front panel')
    assert.ok(decal.position.y < -0.2, 'the stickers stand in front of the cabinet face')
  }
})

test('a piece the palette cannot lay draws nothing, and says so by returning null', () => {
  assert.equal(buildModule({ id: 'x', type: 'wall', x: 0, y: 0, z: 0, rot: 0, cfg: {} }, ctx), null)
})

test('glass lifts expose their frame and moving car; steel keeps its solid enclosure', () => {
  for (let rot = 0; rot < 4; rot++) {
    const mod = palette('lift', rot)
    const { group } = build(mod)
    const panels = []
    group.traverse((o) => { if (o.name === 'shaft-glass') panels.push(o) })
    assert.ok(panels.length >= 6)
    assert.ok(panels.every((p) => p.material.transparent && !p.material.depthWrite))
    const guideRails = []
    group.traverse((o) => { if (o.name === 'guide-rail') guideRails.push(o) })
    assert.equal(guideRails.length, 2)
    const guideRailXs = guideRails.map((rail) => rail.position.x).sort((a, b) => a - b)
    assert.deepEqual(guideRailXs, [-0.84, 0.84])
    assert.ok(guideRails.every((rail) => rail.position.y === 0 && rail.material === mats.darkSteel))
    const brackets = []
    group.traverse((o) => { if (o.name === 'guide-rail-bracket') brackets.push(o) })
    assert.ok(brackets.length > 0)
    assert.ok(brackets.every((bracket) => Math.abs(bracket.position.x) === 0.88 && bracket.position.y === 0))
    const cabin = group.userData.liftCabin
    const leaves = group.userData.doors
    assert.equal(leaves.length, 4)
    assert.ok(leaves.every((d) => d.parent === cabin && d.children.length > 0))
    const shut = leaves.map((d) => d.position.x)
    setDoors(group, 1)
    leaves.forEach((leaf, i) => assert.equal(leaf.position.x, shut[i] + leaf.userData.openSign * leaf.userData.travel))
    setDoors(group, 0)
    assert.equal(sizeOf(group), '2.04×2.04×5', `rot ${rot}`)
    const old = build({ ...mod, cfg: { style: 'steel' } })
    assert.equal(old.meshes, 37, 'the moving cabin includes its floor selector')
    // The steel front wall makes the plan a centimetre asymmetric, so a quarter
    // turn swaps the two horizontal numbers. The foot ring is fitted inside the
    // 2 × 2 plan, so its 2.02 m bar is the short side now.
    assert.ok(['2.02×2.04×5', '2.04×2.02×5'].includes(old.size), `steel rot ${rot}: ${old.size}`)
  }
})

test('the 大 lift scales its shaft, car and landing portals to the 3 × 3 plan', () => {
  for (const style of ['glass', 'steel']) {
    const mod = liftModule({ x: 4, y: 4, z: 0 }, 0, `big-${style}`, LIFT_STEP, 3)
    mod.cfg.style = style
    const cells = liftLandingRows(mod, 0).flat().map(([x, y]) => ({ x, y, z: 0, fill: 'solid' }))
    const before = data
    data = { ...data, cells }
    const { group } = build(mod)
    try {
      assert.equal(group.position.x, 5.5, `${style}: the shaft is centred on the 3 m plan`)
      assert.equal(group.position.y, 5.5)
      const shaft = box(group).getSize(new THREE.Vector3())
      assert.ok(shaft.x > 2.9 && shaft.x < 3.1, `${style}: the drawn shaft spans the 3 × 3 plan (${shaft.x})`)
      assert.ok(shaft.y > 2.9 && shaft.y < 3.1)
      const cabin = box(group.userData.liftCabin).getSize(new THREE.Vector3())
      assert.ok(cabin.x > 2.2 && cabin.x < 2.4, `${style}: the car grows with the shaft (${cabin.x})`)
      const landings = group.userData.liftLandings
      assert.equal(landings.length, 1)
      assert.equal(landings[0].userData.doors.length, 4, 'one landing still carries a telescoping pair per half')
    } finally {
      data = before
      ctx.data = before
    }
  }
})

test('lift panels telescope on separate tracks within the shaft at every opening fraction', () => {
  for (const style of ['glass', 'steel']) for (let rot = 0; rot < 4; rot++) {
    const mod = liftWithDoorSide(liftModule({ x: 4, y: 4, z: 0 }, rot, 'telescoping'), 0, 'both')
    mod.cfg.style = style
    const cells = liftLandingRows(mod, 0).flat().map(([x, y]) => ({ x, y, z: 0, fill: 'solid' }))
    const group = buildModule(mod, { ...ctx, data: { ...data, cells, modules: [mod] } })
    const owners = [group, ...group.userData.liftLandings]
    for (const owner of owners) {
      const banks = new Map()
      for (const leaf of owner.userData.doors) {
        const key = `${leaf.userData.side ?? 0},${leaf.userData.openSign}`
        if (!banks.has(key)) banks.set(key, [])
        banks.get(key).push(leaf)
      }
      for (const panels of banks.values()) {
        assert.equal(panels.length, 2)
        const [inner, outer] = panels
        const width = inner.geometry.parameters.width
        assert.ok(Math.abs(inner.position.y - outer.position.y) >= 0.074, 'separate tracks clear the metal frames')
        assert.ok(Math.abs(inner.position.x - outer.position.x) < width, 'closed panels overlap at their meeting seam')
        assert.ok(inner.userData.travel > outer.userData.travel, 'inner panel catches the slower outer panel')
        for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
          setDoors(owner, fraction)
          assert.ok(Math.abs(inner.position.x - outer.position.x) <= width, 'panels retain their lap while moving')
          for (const leaf of panels) {
            assert.ok(Math.abs(leaf.position.x) + width / 2 < 0.9, 'panels stay within the shaft')
            assert.ok(Math.abs(leaf.position.x - leaf.userData.closedX - leaf.userData.openSign * leaf.userData.travel * fraction) < 1e-8)
          }
          if (fraction === 1) {
            assert.ok(Math.abs(inner.position.x - outer.position.x) < 1e-8, 'open panels stack at the jamb')
            const clearWidth = 2 * (Math.abs(inner.position.x) - width / 2)
            assert.ok(clearWidth > 0.95 && clearWidth < 1.05, 'opening stays approximately one metre wide')
          }
        }
      }
    }
  }
})

test('landing doors close the shaft below its capped top and open only with the aligned car', () => {
  // A shaft is exactly its floor intervals, so its **top landing is capped** and has
  // no room for a portal. Every landing below it does: here a two-interval
  // shaft has doors at the base and the intermediate floor.
  for (const style of ['glass', 'steel']) for (let rot = 0; rot < 4; rot++) {
    const mod = liftModule({ x: 4, y: 4, z: -8 }, rot, 'doors')
    mod.to.z = 0
    mod.cfg.rises = [4, 4]
    mod.cfg.style = style
    const cells = [-8, -4, 0].flatMap((z) =>
      liftLandingRows(mod, z).flat().map(([x, y]) => ({ x, y, z, fill: 'solid' })))
    const group = buildModule(mod, { ...ctx, data: { ...data, cells, modules: [mod] } })
    const cabin = group.userData.liftCabin
    const landings = group.userData.liftLandings
    assert.deepEqual(landings.map((landing) => landing.position.z), [0, 4], 'doors below the capped top; the top itself has no portal')
    assert.ok(landings.every((landing) => landing.parent === group && landing.userData.doors.length === 4))
    const sceneCtx = { lastStateTime: 0, stateIntervalMs: 1000 }
    const system = new LiftSystem(sceneCtx)
    system.liftRigs.push({ key: '4,4,-8', group, cabin, originZ: -7, baseFrom: -7, baseTo: -7, doorFrom: 0, doorTo: 0, side: 1, have: false })
    const pose = (height, open, side = 1) => new Float32Array([4, 4, -8, 0, height, open, side])
    const checkDoors = (owner, fraction) => {
      for (const leaf of owner.userData.doors) {
        assert.ok(Math.abs(leaf.position.x - leaf.userData.closedX - leaf.userData.openSign * leaf.userData.travel * fraction) < 1e-6)
      }
    }
    system.setLifts(pose(-7, 1))
    system.updateLifts(1000)
    checkDoors(group, 1)
    checkDoors(landings[0], 1)
    checkDoors(landings[1], 0)
    system.setLifts(pose(-7, 0))
    system.updateLifts(500)
    checkDoors(group, 0.5)
    checkDoors(landings[0], 0.5)
    system.updateLifts(1000)
    system.setLifts(pose(-3, 0))
    system.updateLifts(500)
    assert.equal(cabin.position.z, 2)
    assert.deepEqual(landings.map((landing) => landing.position.z), [0, 4], 'landing doors stay on their floors as the car travels')
    landings.forEach((landing) => checkDoors(landing, 0))
    system.updateLifts(1000)
    system.setLifts(pose(-3, 1))
    system.updateLifts(500)
    checkDoors(group, 0.5)
    checkDoors(landings[0], 0)
    checkDoors(landings[1], 0.5)
    group.updateMatrixWorld(true)
    setDoors(landings[0], 0)
    const localOrigin = new THREE.Vector3(0, -2, 1.24)
    const origin = group.localToWorld(localOrigin)
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion)
    const ray = new THREE.Raycaster(origin, direction)
    assert.ok(ray.intersectObject(landings[0], true).length > 0, 'the empty lower floor is visibly closed by its own doors')
  }
})

test('a two-sided intermediate storey builds a landing and car door on both faces, and the car opens only the face it was called to', () => {
  // §5.1: a storey may be reconfigured to open on its front (local −y), its back
  // (local +y) or both. The shaft then has to carry a real landing and a real car
  // door on **each** face a storey serves — and the renderer must slide only the
  // face the sim named in the snapshot's side mask (bit 1 front, bit 2 back), so a
  // through-floor opens onto the landing the car was called to and not the other.
  // The top landing is capped and draws no portal.
  for (const style of ['glass', 'steel']) {
    // Lower storey opens to the back, intermediate to the front — one shaft, both faces.
    const mod = liftWithDoorSide(liftWithDoorSide(liftModule({ x: 4, y: 4, z: 0 }, 0, `through-${style}`), 0, 'back'), LIFT_STEP, 'front')
    mod.to.z = 2 * LIFT_STEP
    mod.cfg.rises = [LIFT_STEP, LIFT_STEP]
    mod.cfg.style = style
    const cells = [0, LIFT_STEP, 2 * LIFT_STEP].flatMap((z) =>
      liftLandingRows(mod, z).flat().map(([x, y]) => ({ x, y, z, fill: 'solid' })))
    const group = buildModule(mod, { ...ctx, data: { ...data, cells, modules: [mod] } })
    const cabin = group.userData.liftCabin
    const landings = group.userData.liftLandings
    assert.equal(landings.length, 2, `${style}: a portal for each served storey below the capped top`)
    const lower = landings.find((l) => l.userData.bank === 2)
    const upper = landings.find((l) => l.userData.bank === 1)
    assert.ok(lower, `${style}: the back storey's landing is on the back face`)
    assert.ok(upper, `${style}: the front storey's landing is on the front face`)
    assert.equal(lower.position.y, 0.82, `${style}: the back landing stands past the local +y wall`)
    assert.equal(upper.position.y, -0.82, `${style}: the front landing stands past the local −y wall`)

    // The car carries four telescoping panels per face, banked by their own ±y.
    const cabinDoors = group.userData.doors
    assert.equal(cabinDoors.length, 8, `${style}: four telescoping car panels on each face`)
    const backLeaves = cabinDoors.filter((d) => d.userData.side === 1)
    const frontLeaves = cabinDoors.filter((d) => d.userData.side === -1)
    assert.equal(backLeaves.length, 4)
    assert.equal(frontLeaves.length, 4)
    assert.ok(backLeaves.every((d) => d.position.y > 0), `${style}: the back leaves sit on +y`)
    assert.ok(frontLeaves.every((d) => d.position.y < 0), `${style}: the front leaves sit on −y`)

    const sceneCtx = { lastStateTime: 0, stateIntervalMs: 1000 }
    const system = new LiftSystem(sceneCtx)
    // group origin sits at from.z + 1; the cabin floor rides at world z, so its
    // local offset is `cabinZ − originZ` and the lower landing lines up at 1.
    system.liftRigs.push({ key: '4,4,0', group, cabin, originZ: 1, baseFrom: 1, baseTo: 1, doorFrom: 0, doorTo: 0, side: 1, have: false })
    const leaves = (owner) => owner.userData.doors
    const isOpen = (leaf) => Math.abs(leaf.position.x - leaf.userData.closedX) > 1e-9

    // Called to the lower (back) storey: the back face opens, the front stays shut.
    system.setLifts(new Float32Array([4, 4, 0, LIFT_STEP, 1, 1, 2]))
    system.updateLifts(1000)
    assert.ok(backLeaves.every(isOpen), `${style}: the back car doors open onto the back storey`)
    assert.ok(frontLeaves.every((d) => !isOpen(d)), `${style}: the front car doors stay shut`)
    assert.ok(leaves(lower).length > 0 && leaves(lower).every(isOpen), `${style}: the back landing opens with the car`)
    assert.ok(leaves(upper).every((d) => !isOpen(d)), `${style}: the front landing stays shut`)

    // Called to the intermediate (front) storey: now only the front face opens.
    system.setLifts(new Float32Array([4, 4, 0, LIFT_STEP, LIFT_STEP + 1, 1, 1]))
    system.updateLifts(2000)
    assert.ok(frontLeaves.every(isOpen), `${style}: the front car doors open onto the front storey`)
    assert.ok(backLeaves.every((d) => !isOpen(d)), `${style}: the back car doors stay shut`)
    assert.ok(leaves(upper).every(isOpen), `${style}: the front landing opens with the car`)
    assert.ok(leaves(lower).every((d) => !isOpen(d)), `${style}: the back landing stays shut`)
  }
})

test('the 电梯 shaft is exactly the stacked floor intervals, with no extra storey', () => {
  // A piece is exactly its floor intervals: a 5 m lift is 5 m from the base floor's
  // surface to the top landing's own surface. It does not assume a whole extra
  // storey above the top landing any more.
  for (const [fromZ, toZ] of [
    [0, LIFT_RISE],
    [0, 2 * LIFT_RISE],
    [-12, -4],
    [-16, -8],
  ]) {
    const base = liftModule({ x: 4, y: 4, z: fromZ }, 0, `lift-${fromZ}-${toZ}`)
    const mod = { ...base, to: { x: base.to.x, y: base.to.y, z: toZ } }
    const size = dims(build(mod).size)
    assert.equal(size[2], toZ - fromZ, `电梯 ${fromZ} → ${toZ}: exactly its intervals`)
  }
})

test('the 电梯 sinks a centimetre below the floor plane so its top cap clears the slab above', () => {
  // The piece is exactly its intervals, so its top cap would otherwise be
  // coplanar with the floor above it and z-fight through the slab. The whole
  // piece (cabin rig included) stands 1 cm lower.
  for (const style of ['glass', 'steel']) {
    for (const [z, interval] of [[0, 5], [-12, 4]]) {
      const base = liftModule({ x: 4, y: 4, z }, 0, `sink-${style}-${z}`, interval)
      const mod = { ...base, cfg: { ...base.cfg, style } }
      const { group } = build(mod)
      assert.ok(Math.abs(group.position.z - (z + 1 - 0.01)) < 1e-9, `${style} ${z}: the shaft foot is 1 cm below the floor plane`)
      let cap
      group.traverse((o) => {
        if (o.isMesh && o.name === 'lift-cap-top') cap = o
      })
      assert.ok(cap, `${style} ${z}: the top cap exists`)
      const top = group.position.z + cap.position.z + cap.geometry.parameters.depth / 2
      assert.ok(Math.abs(top - (mod.to.z + 1 - 0.01)) < 1e-6, `${style} ${z}: the cap's top sits 1 cm below the floor above`)
    }
  }
})

test('a shaft is capped at both ends, and extending moves the caps instead of leaving a middle one', () => {
  // Each placed segment closes at its top and bottom. Extending merges the pieces,
  // so the shared cap in the middle goes away and the caps move to the overall
  // ends: a 4 m shaft has caps at 4 and 0; a 4 m + 4 m shaft at 8 and 0, with
  // nothing at the old 4 m joint.
  const caps = (group) => {
    const z = []
    group.traverse((o) => {
      if (o.isMesh && (o.name === 'lift-cap-top' || o.name === 'lift-cap-bottom')) z.push(o.position.z)
    })
    return z
  }
  for (const style of ['glass', 'steel']) {
    const single = { ...liftModule({ x: 4, y: 4, z: 0 }, 0, 'cap-single', 4), cfg: { rises: [4], style } }
    const singleCaps = caps(build(single).group)
    assert.ok(singleCaps.some((z) => Math.abs(z - 3.93) < 1e-6), `${style}: a top cap at the interval's end`)
    assert.ok(singleCaps.every((z) => Math.abs(z - 0.07) < 1e-6 || Math.abs(z - 3.93) < 1e-6), `${style}: only the two end caps`)
    const grown = { ...liftExtendedUp({ ...liftModule({ x: 4, y: 4, z: 0 }, 0, 'cap-grown', 4), cfg: { rises: [4] } }, 4), cfg: { rises: [4, 4], style } }
    const grownCaps = caps(build(grown).group)
    assert.ok(grownCaps.some((z) => Math.abs(z - 7.93) < 1e-6), `${style}: the top cap moved to the new total end`)
    assert.ok(grownCaps.every((z) => Math.abs(z - 0.07) < 1e-6 || Math.abs(z - 7.93) < 1e-6), `${style}: no cap left at the middle joint`)
  }
})

test('the lift roof cap clears blocks around its two-metre footprint', () => {
  for (const style of ['glass', 'steel']) {
    const mod = { ...liftModule({ x: 4, y: 4, z: 0 }, 0, `cap-clearance-${style}`, 5), cfg: { rises: [5], style } }
    let cap
    build(mod).group.traverse((o) => {
      if (o.isMesh && o.name === 'lift-cap-top') cap = o
    })
    assert.ok(cap, `${style}: top cap exists`)
    const { width, height } = cap.geometry.parameters
    assert.ok(width < 2 && height < 2, `${style}: top cap stays inside the 2 × 2 m module footprint`)
    assert.ok(Math.abs(cap.position.x - width / 2 + 0.99) < 1e-6, `${style}: one-centimetre clearance on the left`)
    assert.ok(Math.abs(cap.position.x + width / 2 - 0.99) < 1e-6, `${style}: one-centimetre clearance on the right`)
    assert.ok(Math.abs(cap.position.y - height / 2 + 0.99) < 1e-6, `${style}: one-centimetre clearance at the front`)
    assert.ok(Math.abs(cap.position.y + height / 2 - 0.99) < 1e-6, `${style}: one-centimetre clearance at the back`)
  }
})

test('glass lift guide rails stop at the underside of the top cap', () => {
  const mod = { ...liftModule({ x: 4, y: 4, z: 0 }, 0, 'guide-rail-cap', 5), cfg: { rises: [5], style: 'glass' } }
  const group = build(mod).group
  const rails = []
  let cap
  group.traverse((o) => {
    if (!o.isMesh) return
    if (o.name === 'guide-rail') rails.push(o)
    if (o.name === 'lift-cap-top') cap = o
  })
  assert.equal(rails.length, 2, 'both side rails remain present')
  assert.ok(cap, 'the top plate remains present')
  const top = (mesh) => mesh.position.z + mesh.geometry.parameters.depth / 2
  const capBottom = cap.position.z - cap.geometry.parameters.depth / 2
  assert.ok(rails.every((rail) => Math.abs(top(rail) - capBottom) < 1e-6), 'rails meet the cap underside without passing through it')
})

test('an upper level whose slab is cut away under the cabin still draws its landing doors', () => {
  // The cabin passes through the upper slab, so the 2 × 2 shaft cells are holes in
  // the render data while the landing row in front of the door is solid floor. The
  // door must follow the landing row, not the shaft cell.
  const base = liftExtendedUp(liftModule({ x: 4, y: 4, z: 0 }, 0, 'upper-door', 4), 4)
  const cells = [
    ...[
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ].map(([x, y]) => ({ x, y, z: 0, fill: 'solid' })),
    ...[
      [4, 3],
      [5, 3],
      [4, 4],
      [5, 4],
    ].map(([x, y]) => ({ x, y, z: 0, fill: 'solid' })),
    // Upper level: only the landing row, not the shaft footprint.
    ...[
      [4, 3],
      [5, 3],
    ].map(([x, y]) => ({ x, y, z: 4, fill: 'solid' })),
  ]
  const group = buildModule(base, { ...ctx, data: { ...data, cells, modules: [base] } })
  assert.deepEqual(group.userData.liftLandings.map((l) => l.position.z), [0, 4], 'the upper level has its own landing doors')
  assert.ok(group.userData.liftLandings.every((l) => l.userData.doors.length === 4))
})

test('a both-side level opens both landing doors and both car faces in one pose', () => {
  const mod = liftWithDoorSide(liftWithDoorSide(liftExtendedUp(liftModule({ x: 4, y: 4, z: 0 }, 0, 'both-doors', 5), 5), 0, 'both'), LIFT_STEP, 'front')
  const cells = [0, LIFT_STEP].flatMap((z) =>
    liftLandingRows(mod, z).flat().map(([x, y]) => ({ x, y, z, fill: 'solid' })))
  const group = buildModule(mod, { ...ctx, data: { ...data, cells, modules: [mod] } })
  const cabin = group.userData.liftCabin
  const landings = group.userData.liftLandings
  assert.equal(landings.length, 3, 'front + back at the base level, front at the upper level')
  const base = landings.filter((l) => l.position.z === 0)
  assert.equal(base.length, 2, 'both base faces have a landing')
  const system = new LiftSystem({ lastStateTime: 0, stateIntervalMs: 1000 })
  system.liftRigs.push({ key: '4,4,0', group, cabin, originZ: 1, baseFrom: 1, baseTo: 1, doorFrom: 0, doorTo: 0, side: 1, have: false })
  // Mask 3 = front | back.
  system.setLifts(new Float32Array([4, 4, 0, LIFT_STEP, 1, 1, 3]))
  system.updateLifts(1000)
  const isOpen = (leaf) => Math.abs(leaf.position.x - leaf.userData.closedX) > 1e-9
  for (const landing of base) assert.ok(landing.userData.doors.every(isOpen), 'both base landings open together')
  for (const leaf of group.userData.doors) assert.ok(isOpen(leaf), 'both car faces open together')
  const upper = landings.find((l) => l.position.z === LIFT_STEP)
  assert.ok(upper && upper.userData.doors.every((d) => !isOpen(d)), 'the upper landing stays shut while the car is below')
})

test('the pieces the scene animates carry the handle it animates them by', () => {
  // The scene writes through these names every frame and has nothing to fall back
  // on: a piece that loses one simply stops moving.
  const gate = build(palette('gate'))
  assert.ok(gate.groupKeys.has('wing'), 'a lane 闸机 carries its sliding leaf')
  assert.ok(gate.meshKeys.has('edgeX') && gate.meshKeys.has('fullW'), 'the leaf carries the run it slides along')
  const fenceGate = build(palette('gate', 0, 'up', 'fence'))
  assert.equal(fenceGate.groupKeys.has('wing'), false, 'a fence machine has no lane to open')

  const lift = build(palette('lift'))
  assert.ok(lift.groupKeys.has('doors'), 'an 电梯 carries the doors its cabin slides')
  assert.ok(lift.groupKeys.has('liftCabin'), 'and the cabin the scene glides between stops')

  const escalator = build(palette('escalator'))
  assert.ok(escalator.groupKeys.has('escalator'), 'a 扶梯 carries the rolling step band')
  assert.ok(escalator.instanced >= 2, 'whose steps are instanced batches, not one mesh a step')

  const clock = build(palette('clock'))
  assert.ok(clock.groupKeys.has('clockRig'), 'a 时钟 carries the pivots its hands turn on')

  const psd = build(edge('full'))
  assert.ok(psd.groupKeys.has('doors'), 'a 站台门 carries its own leaves')
  assert.ok(psd.groupKeys.has('line'), 'and knows the line it belongs to')

  for (const label of ['广告牌 横版', '电视']) {
    const row = PIECES.find((p) => p[0] === label)
    const built = build(row[1])
    assert.ok(built.groupKeys.has('adScreen'), `${label}: the lit pane the ad artwork swaps`)
    assert.ok(built.meshKeys.has('adPoster'), `${label}: and the pane's own poster quad`)
  }
  const tv = build(palette('tv'))
  assert.ok(tv.meshKeys.has('adStationPlate'), 'a 电视 prints the station board on its own pane')
  assert.ok(tv.meshKeys.has('adWindow'), 'and the content window beside it')
  assert.ok(tv.meshKeys.has('sharedGeometry'), 'its shared quads are marked, so a teardown never frees them')

  const shop = build(room('shop', 'store'))
  assert.ok(shop.meshKeys.has('wall'), 'every room wall panel is tagged, so the level slice knows it is a wall')
})

test('half-height screen caps slide clear with each door leaf', () => {
  const { group } = build(edge('half'))
  const caps = group.userData.doors.filter((m) => m.name === 'half-door-cap')
  assert.ok(caps.length > 0, 'the low doors have moving black caps')
  const before = caps.map((m) => m.position.x)
  setDoors(group, 1)
  caps.forEach((cap, i) => {
    assert.equal(round(Math.abs(cap.position.x - before[i])), round(STOCK.B.doorWidth * 0.98 / 2), 'each cap travels a full scaled leaf width')
  })
  const openingCentre = (before[0] + before[1]) / 2
  group.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(openingCentre + group.position.x, group.position.y - 3, group.position.z + 1 + PSD_HALF_HEIGHT), new THREE.Vector3(0, 1, 0))
  assert.equal(ray.intersectObject(group, true).length, 0, 'no fixed black rail crosses an open doorway')
  setDoors(group, 0)
  caps.forEach((cap, i) => assert.equal(cap.position.x, before[i], 'the cap returns with its door'))
})

test('train roofs share body paint and meet the cab without overlapping shells', () => {
  for (const stock of ['A', 'B', 'C', 'L']) {
    const g = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 1, stock, doorsOpen: false, colour: '#1f5fd0', dirSign: 1, yaw: 0 })
    g.updateMatrixWorld(true)
    const roof = g.getObjectByName('car-roof')
    assert.equal(roof.material, mats.trainBody, 'the roof uses the same paint as the body')
    const roofBounds = box(roof)
    g.traverse((o) => {
      if (o.name !== 'cab-shell') return
      const bounds = box(o)
      if (o.position.x > 0) assert.ok(Math.abs(bounds.min.x - roofBounds.max.x) < 1e-5, 'front shell meets the roof at a single seam')
      else assert.ok(Math.abs(bounds.max.x - roofBounds.min.x) < 1e-5, 'rear shell meets the roof at a single seam')
    })
  }
})

test('train motion interpolates every frame and resumes from the drawn pose', () => {
  const ctx = { scene: new THREE.Scene(), modelMats: mats, levelBase: 0, lastStateTime: performance.now(), stateIntervalMs: 1000 }
  const system = new TrainSystem(ctx)
  system.level = { applyGroupLevel: (group) => { group.visible = true } }
  const pose = (x) => new Float32Array([x, 0, 0, 1, 3, 0, 0xc8102e, 1, 0, 1])
  system.setTrains(pose(0))
  ctx.lastStateTime = performance.now()
  system.setTrains(pose(10))
  const train = system.trainGroup.children[0]
  for (const [ms, x] of [[250, 2.5], [500, 5], [750, 7.5]]) {
    system.updateTrains(ctx.lastStateTime + ms, 0)
    assert.ok(Math.abs(train.position.x - x) < 1e-6, `the train should be at ${x} m between snapshots, got ${train.position.x}`)
  }
  ctx.lastStateTime = performance.now()
  system.setTrains(pose(20))
  system.updateTrains(ctx.lastStateTime + 500, 0)
  assert.ok(Math.abs(train.position.x - 13.75) < 1e-6, 'an early snapshot continues from the last drawn 7.5 m pose')
  system.setTrains(new Float32Array())
  ctx.lastStateTime = performance.now()
  system.setTrains(pose(-30))
  assert.equal(train.position.x, -30, 'a new service starts at its approach pose instead of interpolating backward')
  system.dispose()
})

test('half-height caps sit above black rails and keep a compact slide lane', () => {
  const { group } = build(edge('half'))
  const rails = group.children.filter((o) => o.name === 'psd-fixed-rail' || o.name === 'half-door-rail')
  const caps = group.children.filter((o) => o.name === 'psd-fixed-cap' || o.name === 'half-door-cap')
  for (const cap of caps) {
    const bounds = box(cap)
    assert.ok(Math.abs(bounds.min.z - (1 + PSD_HALF_HEIGHT - 0.05)) < 1e-6, 'the cap starts at the black rail top instead of intersecting it')
    assert.ok(Math.abs(bounds.max.z - (1 + PSD_HALF_HEIGHT)) < 1e-6, 'the cap stays inside the reserved height')
    assert.ok(bounds.getSize(new THREE.Vector3()).y < 0.101, 'the black cap is only 10 cm deep')
  }
  for (const rail of rails) assert.ok(Math.abs(box(rail).max.z - (1 + PSD_HALF_HEIGHT - 0.05)) < 1e-6)
  const pane = group.getObjectByName('psd-fixed-glass')
  const moving = group.getObjectByName('psd-door-glass')
  assert.ok(Math.abs(Math.abs(pane.position.y - moving.position.y) - 0.05) < 1e-6, 'the moving glass is flush with the fixed cap and pillar back faces')
  for (const glass of [pane, moving]) {
    assert.equal(glass.material.depthWrite, false, 'transparent glass cannot occlude another pane at grazing angles')
    assert.equal(glass.material.polygonOffset, true, 'PSD glass stays ahead of a flush platform wall in the depth buffer')
    assert.equal(glass.material.polygonOffsetFactor, -1)
    assert.equal(glass.geometry.type, 'PlaneGeometry', 'each pane draws a single glass surface')
  }
})

test('the cabin carries formed benches, seat-end guards, straps and ceiling lighting', () => {
  const g = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 1, stock: 'L', doorsOpen: false, colour: '#c8102e', dirSign: 1, yaw: 0 })
  for (const name of ['cabin-bench', 'seat-end-panel', 'seat-end-handrail', 'overhead-handrail', 'hanging-strap', 'cabin-centre-pole', 'cabin-ring-light', 'cabin-light-strip', 'cabin-floor']) {
    assert.ok(g.getObjectByName(name), `the cabin is missing ${name}`)
  }
  assert.equal(g.getObjectByName('cabin-bench').material, mats.steel, 'the formed bench is stainless steel')
  assert.equal(g.getObjectByName('seat-end-handrail').material, mats.gateRed, 'the seat-end handrail follows the red reference fittings')
})

test('train-door glazing sits in an aperture with no painted backing in any pose', () => {
  const g = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 1, stock: 'B', doorsOpen: false, colour: '#1f5fd0', dirSign: 1, yaw: 0 })
  for (const t of [0, 0.5, 1]) {
    setDoors(g, t)
    g.updateMatrixWorld(true)
    for (const leaf of g.userData.doors) {
      const pane = leaf.getObjectByName('train-door-window')
      assert.ok(pane, 'each train door has a glazed aperture')
      const origin = leaf.localToWorld(new THREE.Vector3(0, -0.5, pane.position.z))
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, 1, 0))
      assert.equal(ray.intersectObject(leaf, false).length, 0, 'no opaque painted surface backs the window')
      assert.ok(ray.intersectObject(pane, false).length > 0, 'the window still contains a glass pane')
    }
  }
})

test('screen-door slide lanes clear fixed glass, posts and caps in every pose', () => {
  for (const height of ['half', 'full']) {
    for (const side of ['left', 'right']) {
      const mod = edge(height)
      mod.cfg.side = side
      const { group } = build(mod)
      const fixed = []
      group.traverse((o) => { if (o.name.startsWith('psd-fixed-') || o.name === 'psd-section-pillar' || o.name === 'psd-jamb-return') fixed.push(o) })
      for (const t of [0, 0.25, 0.5, 1]) {
        setDoors(group, t)
        group.updateMatrixWorld(true)
        for (const leaf of group.userData.doors) {
          const movingBox = box(leaf)
          for (const panel of fixed) {
            const fixedBox = box(panel)
            const gap = side === 'left' ? fixedBox.min.y - movingBox.max.y : movingBox.min.y - fixedBox.max.y
            if (leaf.geometry.type === 'PlaneGeometry' && leaf.name !== 'psd-door-glass') continue
            const intersectsXZ = ['x', 'z'].every(axis => Math.min(movingBox.max[axis], fixedBox.max[axis]) - Math.max(movingBox.min[axis], fixedBox.min[axis]) > 1e-6)
            if (intersectsXZ) assert.ok(gap >= -1e-6, `${height}/${side}/${t}: moving fittings must clear the fixed screen without interpenetration, got ${gap}`)
          }
        }
      }
    }
  }
})

test('the sizes that are contracts hold, and not just the numbers above', () => {
  // The 闸机 is a 1020 mm machine, not a 1 m cube.
  assert.equal(round(box(build(palette('gate')).group).getSize(new THREE.Vector3()).z), 1.02)

  // A screen door is drawn to the height the graph reserves for it, so the glass the
  // player sees is the barrier the crowd queues behind.
  const full = box(build(edge('full')).group).max.z - 1
  const half = box(build(edge('half')).group).max.z - 1
  assert.ok(Math.abs(full - PSD_FULL_HEIGHT) < 0.1, `全高 is drawn to PSD_FULL_HEIGHT (${round(full)} vs ${PSD_FULL_HEIGHT})`)
  assert.ok(Math.abs(half - PSD_HALF_HEIGHT) < 0.1, `半高 is drawn to PSD_HALF_HEIGHT (${round(half)} vs ${PSD_HALF_HEIGHT})`)

  // An exit widens by exactly one block per bay; the 无盖 variant trades the canopy
  // for a glass railing over the same plan.
  const width = (id) => round(box(build(palette(id)).group).getSize(new THREE.Vector3()).x)
  assert.deepEqual([width('exit-covered-1'), width('exit'), width('exit-covered-3')], [3.1, 4.1, 5.1], '有盖: 单向 / 双向 / 三向 are 3 / 4 / 5 blocks across')
  assert.deepEqual([width('exit-uncovered-1'), width('exit-uncovered-2'), width('exit-uncovered-3')], [3.04, 4.04, 5.04], '无盖: the same plan under a railing')
  assert.ok(box(build(palette('exit-uncovered-2')).group).getSize(new THREE.Vector3()).z < 1.35, 'and 无盖 has no roof to stand on')

  // A stair climbs its own rise over its own run.
  const stair = box(build(palette('stair-straight')).group).getSize(new THREE.Vector3())
  assert.ok(stair.y > STAIR_RUN && stair.y < STAIR_RUN + 1, `a straight flight runs STAIR_RUN (${round(stair.y)} vs ${STAIR_RUN})`)
  assert.ok(stair.z > STAIR_RISE, `and climbs STAIR_RISE (${round(stair.z)} vs ${STAIR_RISE})`)

  // A two-cell run reaches into the second cell; the 1 m piece stays in its own.
  const span = (id) => round(box(build(palette(id)).group).getSize(new THREE.Vector3()).x)
  assert.ok(span('bench-steel-2') > 1.5 && span('bench-steel-1') < 1, 'the 2 m 座椅 spans two cells and the 1 m one does not')
  assert.ok(span('billboard-panorama') > 2.5, 'the 长幅 banner spans its three cells')

  // A 门 is a **full-height** panel and a 双开 one spans two cells, so what the piece
  // reserves off its wall is what it draws. (Micron slop: the group is turned by the
  // placement rotation, so `Box3.setFromObject` comes back a few ulps out.)
  const doorSize = (id) => box(build(palette(id)).group).getSize(new THREE.Vector3())
  const single = doorSize('door-steel-1')
  const pair = box(build(createModule('door-steel-2', 4, 4, 0, 'wide-door', 0)).group).getSize(new THREE.Vector3())
  assert.ok(Math.abs(single.z - 1.99) < 1e-6, `a 门 fits below a two-block wall opening (${round(single.z)})`)
  assert.equal(round(pair.x), 2, 'and a 双开 door spans the two cells it reserves')
  assert.equal(round(single.y), round(pair.y), 'every 门 is one panel deep, whatever its width')

  // The 办公室 / 厕所 doorway is the **same piece**, not a look-alike: the room's door
  // is drawn to the 门's own height, and its opening's width picks the leaf count off
  // the same builder (`render/models/pieces/DoorModel.ts`).
  const roomDoor = (door) => {
    const mod = { id: 'shop-1', type: 'shop', x: 4, y: 4, z: 0, w: 5, h: 4, rot: 0, cfg: { kind: 'office', door } }
    ctx.data = data = { ...data, modules: [mod] }
    const group = buildModule(mod, ctx)
    group.updateMatrixWorld(true)
    // The room's own panels are tagged (`buildRoom`); everything else it draws is the
    // doorway, so the door's own box is what is left.
    const box = new THREE.Box3()
    let meshes = 0
    group.traverse((o) => {
      if (o.isMesh && !o.userData.wall) {
        meshes++
        box.expandByObject(o)
      }
    })
    return { meshes, size: box.getSize(new THREE.Vector3()) }
  }
  const oneLeaf = roomDoor([[6, 4]])
  assert.ok(Math.abs(oneLeaf.size.z - 1.99) < 1e-6, `a room doorway is cut to the 门 piece's own height (${round(oneLeaf.size.z)})`)
  assert.ok(Math.abs(oneLeaf.size.x - single.x) < 1e-6, 'and a one-cell opening draws one leaf of it')
  assert.equal(oneLeaf.meshes, 20, 'a doorway draws exactly the parts a standing 门 does')
  const twoLeaves = roomDoor([
    [6, 4],
    [7, 4],
  ])
  assert.ok(Math.abs(twoLeaves.size.x - pair.x) < 1e-6, 'a two-cell opening draws the pair')
  // The second leaf adds its panel, hinges, two-face handles and studs.
  assert.equal(twoLeaves.meshes - oneLeaf.meshes, 13, 'the second leaf adds its mirrored fittings')

  // 供电: 接触网 hangs a wire overhead, 第三轨 guards a conductor rail at track level.
  const rail = box(build(track({ power: 'third-rail' })).group).getSize(new THREE.Vector3())
  const wire = box(build(track({ power: 'catenary' })).group).getSize(new THREE.Vector3())
  assert.equal(round(rail.x), 8, 'a rail is exactly as long as its run')
  assert.ok(wire.z > rail.z * 3, 'the catenary reaches over the train; the third rail does not')
  const contactStripZ = (cfg) => {
    const group = build(track({ power: 'catenary', ...cfg })).group
    group.updateMatrixWorld(true)
    const box = new THREE.Box3()
    group.traverse((o) => { if (o.isMesh && o.material === mats.wood) box.expandByObject(o) })
    return box.min.z
  }
  const contactHeights = [contactStripZ({}), contactStripZ({ catenaryStyle: 'gantry' }), contactStripZ({ tunnel: true }), contactStripZ({ bridge: true })]
  assert.ok(contactHeights.every(z => Math.abs(z - (track({}).z + CONTACT_STRIP_Z)) < 1e-6), 'all conductor strips meet the compact collector contact height')
  assert.ok(contactHeights.every((z) => Math.abs(z - contactHeights[0]) < 1e-6), 'station, tunnel and bridge contact strips share one rail-relative height')
  const bridgeBarrier = build(track({ bridge: true, power: 'catenary', bridgeRailing: 'sound-barrier' })).group
  bridgeBarrier.updateMatrixWorld(true)
  const barrierPostXs = []
  let bridgeGantryPosts = 0
  bridgeBarrier.traverse((o) => {
    if (!o.isMesh) return
    const bounds = new THREE.Box3().setFromObject(o)
    const size = bounds.getSize(new THREE.Vector3())
    const centre = bounds.getCenter(new THREE.Vector3())
    if (o.material === mats.steel && Math.abs(size.z - 3) < 1e-6) barrierPostXs.push(centre.x)
    if (o.name === 'bridge-gantry-post') bridgeGantryPosts++
  })
  assert.equal(bridgeGantryPosts, 1, 'bridge catenary uses one mast on the travel-right edge')
  assert.equal(barrierPostXs.length, 7, 'only the mast side omits its ordinary barrier post')
  assert.equal(barrierPostXs.filter((x) => Math.abs(x - (track({}).x + 0.5)) < 1e-6).length, 1, 'the opposite bank retains its ordinary start post')
  const thirdRailBarrier = build(track({ bridge: true, power: 'third-rail', bridgeRailing: 'sound-barrier' })).group
  thirdRailBarrier.updateMatrixWorld(true)
  let thirdRailBarrierPosts = 0
  thirdRailBarrier.traverse((o) => {
    if (!o.isMesh || o.material !== mats.steel) return
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
    if (Math.abs(size.z - 3) < 1e-6) thirdRailBarrierPosts++
  })
  assert.equal(thirdRailBarrierPosts, 8, 'without overhead gantries, the bridge keeps all four barrier posts per edge')
  const gantry = build(track({ power: 'catenary', catenaryStyle: 'gantry' })).group
  let hasPortalUpright = false
  gantry.traverse((o) => {
    if (!o.isMesh || o.material !== mats.darkSteel) return
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
    if (size.z > 3) hasPortalUpright = true
  })
  assert.ok(hasPortalUpright, 'the alternate station style adds tall portal supports around the same wire')
  assert.ok(Math.abs(box(gantry).max.z - (track({}).z + CONTACT_WIRE_Z + 0.82)) < 1e-6, 'the station posts clear the 5 m contact wire')
  const wideTrack = { ...track({ power: 'catenary', catenaryStyle: 'gantry' }), d: 4 }
  const wideEdge = { id: 'edge-wide', type: 'platform-edge', x: wideTrack.x, y: wideTrack.y, z: wideTrack.z, w: wideTrack.w, cfg: { line: '5', dir: 'up', side: 'left', psd: 'half', from: wideTrack.id } }
  const wideData = { ...data, lines: [{ ...LINE, stock: 'D', power: 'catenary', psd: 'half' }], modules: [wideTrack, wideEdge] }
  const wideGantry = buildModule(wideTrack, { ...ctx, data: wideData })
  wideGantry.updateMatrixWorld(true)
  const trainCentreY = wideTrack.y + 1.65
  const widePostClearances = []
  wideGantry.traverse((o) => {
    if (!o.isMesh || o.material !== mats.darkSteel) return
    const bounds = new THREE.Box3().setFromObject(o)
    if (bounds.getSize(new THREE.Vector3()).z < 3) return
    const centre = bounds.getCenter(new THREE.Vector3())
    widePostClearances.push(Math.abs(centre.y - trainCentreY) - 3.3 / 2)
  })
  const widePostClearance = Math.min(...widePostClearances)
  assert.ok(widePostClearance >= 0.16 - 1e-6, `wide D stock keeps 0.10 m to the post face on the screen-door line (${round(widePostClearance - 0.06)} m)`)
  const trackGroup = build(track({ power: 'third-rail' })).group
  const instance = (name) => trackGroup.getObjectByName(name)
  assert.equal(instance('concrete sleepers').count, 13, 'slab track seats a regular sleeper along the run')
  assert.equal(instance('rail seats').count, 26, 'both rail webs have a seat at every sleeper')
  assert.equal(instance('spring clips').count, 52, 'each seat is retained at both edges')
  assert.equal(instance('anchor bolts').count, 52, 'each rail seat is anchored at both edges')
  let railHeads = 0
  trackGroup.traverse((o) => { if (o.geometry?.type === 'ExtrudeGeometry' && o.material === mats.steel) railHeads++ })
  assert.equal(railHeads, 2, 'both running rails have a shaped steel head')
  // A tunnel's shell is the chunk mesher's, not the piece's: the model is the same.
  assert.equal(build(track({ tunnel: true })).meshes, build(track({})).meshes, 'a tunneled rail draws the same track')

  // A quarter turn moves the run from +y to +x; the piece is the same piece.
  const straight = build(palette('escalator', 0, 'up'))
  const turned = build(palette('escalator', 1, 'down'))
  assert.equal(straight.meshes, turned.meshes, 'the same 扶梯, turned')
  assert.deepEqual([...dims(straight.size)].sort((a, b) => a - b), [...dims(turned.size)].sort((a, b) => a - b), 'drawing the same band')
  assert.ok(dims(straight.size)[1] > dims(straight.size)[0], 'whose run lies along +y unturned')
  assert.ok(dims(turned.size)[0] > dims(turned.size)[1], 'and along +x after a quarter turn')

  // The retail shell is the store room the app's own fit-out builds.
  const store = build(room('shop', 'store'))
  const retail = build(room('retail', undefined))
  assert.equal(retail.meshes, store.meshes, 'the 零售 shell and a 商店 room are the same piece')
  assert.equal(retail.size, store.size, 'drawn to the same size')
  assert.notEqual(build(room('shop', 'toilet')).meshes, store.meshes, 'a 厕所 fits out its own interior')

  // The 指示牌's two mounts are a hung board and a stuck sheet. The **wall** board
  // is only its printed sheet, sitting 3 mm proud of the wall — no housing, no
  // lightbox — so the panel stands on the wall rather than floating in front of
  // it, and it hangs at reading height with no rods, while the
  // overhead board reaches the storey slab it is suspended from. Every box is in world
  // metres and the piece stands on a block top at z = 1, so the heights below are read
  // back off it.
  const wallSign = box(build(palette('sign-wall')).group)
  // A **hung** board is built on a column with nothing over the cell (the room's open middle), so
  // the storey's nominal slab is its ceiling exactly as it always was.
  const hungSign = box(build(palette('sign-ceiling', 0, 'up', 'lane', [6, 6, 0])).group)
  assert.equal(round(wallSign.min.y), 4.003, 'the wall sheet sits 3 mm proud of the wall plane')
  assert.ok(wallSign.max.y - wallSign.min.y < 0.001, 'and has no projecting back box')
  assert.equal(round(wallSign.min.z - 1), 1.45, 'the wall board hangs at the eye height its courses name')
  assert.equal(round(wallSign.max.z - 1), 1.85, 'and its panel crosses exactly the one wall course it asks for')
  assert.ok(hungSign.max.z - 1 > 2.9, 'a 吊挂 board reaches the ceiling its rods bolt to')
  // The hung board rides 0.65 m under the slab and the wall sheet at eye height, so the two are
  // read from different places in the room rather than stacked on one another.
  assert.ok(hungSign.min.z > wallSign.max.z, 'and hangs over the concourse rather than at reading height')
})

test('a 扶梯 carries its own solid under the truss, over the course the ground leaves', () => {
  // The ground under a run always stops **one course** short of the truss: the 方块 brush may not
  // lay that last course, whose top face would sit above the walking line. The renderer filled
  // that course (`rampFillKeys`, `sim/openings.ts`) as a derived cell, which belongs to the
  // ground and kept coming out as four walls with no lid. The escalator draws the body itself,
  // cut to exactly that course: where the ground's filling stood, and no deeper or further.
  const mod = palette('escalator')
  const built = build(mod)
  const solid = built.group.getObjectByName('undercroft')
  assert.ok(solid, 'the 扶梯 carries no solid under the truss')

  // A closed shell: every edge belongs to exactly two triangles, so no side of it — from below,
  // from above, or from the landing it climbs from — shows its own inside.
  const pos = solid.geometry.getAttribute('position')
  const edges = new Map()
  const at = (i) => {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i)
    return `${round(v.x)},${round(v.y)},${round(v.z)}`
  }
  for (let i = 0; i < pos.count; i += 3) {
    for (const [u, v] of [[0, 1], [1, 2], [2, 0]]) {
      const edge = [at(i + u), at(i + v)].sort().join('|')
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  assert.ok(edges.size > 0, 'the undercroft drew no faces at all')
  for (const [edge, shared] of edges) assert.equal(shared, 2, `the undercroft's edge ${edge} is not shared by two faces`)

  // The frame the body is cut in: `slope` is the run's own rise over its horizontal run, and the
  // ground under a run is shaved to `RAMP_FOOT` below the walking line at any station.
  const slope = (mod.to.z - mod.from.z) / Math.hypot(mod.to.x - mod.from.x, mod.to.y - mod.from.y)
  const cutAt = (y) => mod.from.z + 1 + (y - (mod.from.y + 0.5)) * slope - RAMP_FOOT
  const b = box(solid)
  assert.equal(round(b.min.z), mod.from.z + 1 - ESCALATOR_BASE_BURY, 'the base is buried 2 cm below the floor to prevent coplanar faces')
  assert.equal(round(b.min.y), round(mod.from.y + 0.5 + 1.036), 'the undercroft begins where the five-metre incline clears its floor')
  const horizontal = Math.hypot(mod.to.x - mod.from.x, mod.to.y - mod.from.y)
  const end = Math.min(horizontal, 0.5 + Math.ceil((RAMP_FOOT + 1) / Math.abs(slope) - 0.5))
  assert.ok(Math.abs(b.max.y - (mod.from.y + 0.5 + end)) <= 0.2, 'it ends at the last course the ground cut crosses, within the casing clearance')
  assert.ok(Math.abs(b.max.z - (cutAt(b.max.y) - ESCALATOR_SURFACE_CLEARANCE)) <= 0.02, 'its lid stays within 2 cm of the ground cut and inside the truss')
  assert.ok(b.max.z > mod.from.z + 1 + 1, 'its lid flattens off at the course line instead of following the ground up')
  assert.equal(round(b.getSize(new THREE.Vector3()).x), round(ESCALATOR_BALUSTRADE - 2 * ESCALATOR_SURFACE_CLEARANCE), 'the flanks sit 5 mm inside the truss instead of sharing its faces')

  // Solid from below over that course — a ray straight up under the run meets the body, never the
  // gap between the truss and the floor — and no further: past it the run is the shell it was.
  const from = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
  const to = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
  const climb = to.clone().sub(from).normalize()
  // `s` is horizontal distance up the run, as the piece's own frame measures it — the first
  // 0.75 m of it is the trench the cut opens in the floor, which the truss box's own dip is
  // already inside.
  const across = new THREE.Vector3(climb.x, climb.y, 0).normalize()
  const under = (s) => {
    const p = from.clone().add(across.clone().multiplyScalar(s))
    const ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, mod.from.z - 8), new THREE.Vector3(0, 0, 1))
    return ray.intersectObject(built.group, true)[0]?.object.name ?? 'nothing'
  }
  for (const s of [1.1, 1.5, 2, 2.4]) assert.equal(under(s), 'undercroft', `nothing solid under the run ${s} m up from the landing`)
  for (const s of [3.8, 4.5, 5.5]) assert.notEqual(under(s), 'undercroft', `the body reaches past the course the ground stops at (${s} m)`)

  // The lid stays 5 mm below that plane, to the body's very end. It remains
  // buried in the truss without sharing the terrain cap's depth or opening a
  // slit where a flat cap would stop short of the truss's underside.
  let worst = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(solid.matrixWorld)
    worst = Math.max(worst, v.z - cutAt(v.y))
  }
  assert.ok(Math.abs(worst + ESCALATOR_SURFACE_CLEARANCE) <= 0.025, `the body's lid must stay within 2.5 cm of the cut plane, got ${worst.toFixed(4)} m`)

  // And no slit under the truss. The body's lid has to sit **above** the truss box's own underside
  // wherever the two overlap, or its last stretch — and its end face — stands in the open with the
  // truss floating over it, which is exactly what a lid flattened off at the course line left.
  const alongRun = (mesh, pick) => {
    const p = mesh.geometry.getAttribute('position')
    const v = new THREE.Vector3()
    let best = pick === 'max' ? -Infinity : Infinity
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld)
      const plane = v.z - slope * v.y
      best = pick === 'max' ? Math.max(best, plane) : Math.min(best, plane)
    }
    return best
  }
  const lid = alongRun(solid, 'max')
  const trussUnderside = alongRun(built.group.getObjectByName('truss'), 'min')
  assert.ok(lid > trussUnderside, `the body stops ${(trussUnderside - lid).toFixed(4)} m short of the truss's underside`)

  // Direction only orders the travel the sim reads: a down run is the same body in the same
  // place, so the two directions of one bank fill the same space.
  const down = box(build(palette('escalator', 0, 'down')).group.getObjectByName('undercroft'))
  assert.deepEqual(down.min.toArray().map(round), b.min.toArray().map(round), 'a down run carries its solid somewhere else')
  assert.deepEqual(down.max.toArray().map(round), b.max.toArray().map(round), 'a down run carries its solid somewhere else')
})

test('a consist is cars × carLength of body, with a cab and its doors on both sides', () => {
  for (const stock of ['A', 'B', 'C', 'L']) {
    const pose = { x: 0, y: 0, z: 0, cars: 6, stock, doorsOpen: false, colour: '#1f5fd0', dirSign: 1, yaw: 0 }
    const g = buildTrain(mats, pose)
    const s = STOCK[stock]
    const length = s.length * pose.cars
    const size = box(g).getSize(new THREE.Vector3())
    // The body is exactly the consist: only the coupler hangs past the nose.
    assert.ok(size.x > length && size.x < length + 1.8, `${stock}: only the two projecting couplers extend beyond cars × carLength (${round(size.x)} vs ${round(length)})`)
    // The shell is the stock's width; the sliding door lanes and kick plates
    // stand up to 12 cm proud on each side to clear the stationary seals.
    assert.ok(size.y >= s.width && size.y < s.width + 0.25, `${stock}: shell plus door fittings (${round(size.y)} vs ${s.width})`)
    // One leaf per modelled door, and every door has two leaves a side.
    const cadence = doorCentres({ stock, cars: pose.cars })
    assert.equal(g.userData.doors.length, cadence.length * 4, `${stock}: every door has two leaves a side`)
    // A leaf has to **read as a door** and wear the car's own paint. Both halves of that
    // were learned the hard way: `trainDark` is the value of the cabin shadow behind the
    // doorway, so a closed consist photographed as a row of black rectangles with no door
    // in it (sheets 05 and 11), and `steel` is `metalness: 0.72` — with no environment map
    // a metal has no diffuse, so the ambient light in the rig never reached the leaf and it
    // came out charcoal beside a near-white body.
    for (const leaf of g.userData.doors) {
      assert.equal(leaf.material, mats.trainBody, `${stock}: a door leaf does not wear the body's paint`)
      assert.ok(
        leaf.children.some((c) => c.material === mats.glass),
        `${stock}: a door leaf wears no window`,
      )
    }
    assert.equal(g.userData.ownedMats.length, 2, `${stock}: the consist owns its livery and cabin floor materials`)

    // Both ends wear a cab, and only the lamps tell them apart: white leads, red trails.
    const head = []
    const tail = []
    g.traverse((o) => {
      if (!o.isMesh) return
      const p = new THREE.Vector3()
      o.getWorldPosition(p)
      if (o.material === mats.headlight) head.push(p.x)
      if (o.material === mats.taillight) tail.push(p.x)
    })
    assert.ok(head.length > 0 && tail.length > 0, `${stock}: both ends light up`)
    assert.ok(Math.min(...head) > 0, `${stock}: the leading end (+x) carries the white lamps`)
    assert.ok(Math.max(...tail) < 0, `${stock}: and the trailing end the red ones`)
  }
})

test('the per-frame setters move the piece they are given, and nothing else', () => {
  // The 闸机's leaf slides into its cabinet with its hinge end held fixed.
  const gate = build(palette('gate')).group
  const gateLeaves = gate.userData.wing.children
  for (const open of [0, 0.5, 1]) {
    setGateWing(gate, open)
    for (const leaf of gateLeaves) {
      const { fullW, edgeX, sign } = leaf.userData
      assert.equal(round(leaf.position.x - sign * fullW * leaf.scale.x / 2), round(edgeX), 'each cabinet edge stays fixed')
      assert.equal(round(leaf.scale.x), round(1 - open * (1 - 0.025 / fullW)))
    }
  }
  setGateWing(build(palette('gate', 0, 'up', 'fence')).group, 1) // a fence machine has no leaf: a no-op, not a throw

  // The 扶梯's band rolls with the clock, wraps in its own run, and reverses with the
  // direction, so a descending escalator carries its steps the other way.
  const up = build(palette('escalator', 0, 'up')).group.userData.escalator
  const down = build(palette('escalator', 0, 'down')).group.userData.escalator
  assert.equal(up.phase, 0, 'a fresh band is at its start')
  rollEscalator(up, 2)
  assert.equal(round(up.phase), round((ESCALATOR_SPEED * 2) % up.runLen), 'the band rolls at the escalator speed')
  rollEscalator(up, 1e6)
  assert.ok(up.phase >= 0 && up.phase < up.runLen, 'and wraps into its own run length')
  rollEscalator(down, 2)
  assert.equal(round(down.phase), round(down.runLen - ((ESCALATOR_SPEED * 2) % down.runLen)), 'a down escalator rolls the other way')

  // The train's two banks open independently, which is what keeps a tunnel-side bank
  // shut against the wall while the platform-side one opens.
  const train = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 2, stock: 'B', doorsOpen: false, colour: '#1f5fd0', dirSign: 1, yaw: 0 })
  const leaves = train.userData.doors
  const moved = () => leaves.filter((d) => Math.abs(d.position.x - d.userData.closedX) > 1e-9).length
  setDoors(train, 0)
  assert.equal(moved(), 0, 'shut: every leaf is at its closed position')
  setDoors(train, 1)
  assert.equal(moved(), leaves.length, 'open: every leaf slid')
  setDoors(train, 0)
  setDoorsSides(train, 1, 0)
  const plus = leaves.filter((d) => (d.userData.side ?? 1) === 1)
  const minus = leaves.filter((d) => (d.userData.side ?? 1) === -1)
  assert.ok(plus.length > 0 && minus.length > 0, 'a consist has two banks')
  assert.ok(plus.every((d) => Math.abs(d.position.x - d.userData.closedX) > 1e-9), 'the bank with a platform to meet opens')
  assert.ok(minus.every((d) => Math.abs(d.position.x - d.userData.closedX) < 1e-9), 'and the wall side stays shut')
})

test('the track ghost carries the direction arrows a placed track does not', () => {
  // The player commits a rail on the strength of which way it runs, and the ghost is
  // the only place that is drawn: one arrow per ~18 m of run, capped at eight, flipped
  // for a 下行 piece.
  const glow = (group) => {
    let n = 0
    let flipped = 0
    group.traverse((o) => {
      if (!o.isMesh || o.material !== mats.glow) return
      n++
      for (let p = o.parent; p; p = p.parent) {
        if (Math.abs(Math.abs(p.rotation.z) - Math.PI) < 1e-9) {
          flipped++
          break
        }
      }
    })
    return { n, flipped }
  }
  const placed = build(track({}))
  assert.equal(glow(placed.group).n, 0, 'a placed track is a bed and rails, with no arrow left on it')
  assert.equal(glow(build(track({}), true).group).n, 1, 'an 8 m ghost carries one arrow')
  assert.equal(glow(build({ ...track({}), w: 40 }, true).group).n, 2, 'a 40 m one carries one per ~18 m')
  assert.equal(glow(build({ ...track({}), w: 400 }, true).group).n, 8, 'and never more than eight, however long the run')
  const down = glow(build(track({ dir: 'down' }), true).group)
  assert.equal(down.n, 1, 'a 下行 ghost draws its arrow too')
  assert.equal(down.flipped, 1, 'turned end for end, so the arrow points the other way')
})

test('a teardown frees every geometry a group owns — the instance buffers included — and keeps the shared kit', () => {
  // This is the leak the scene pays for on **every** rebuild, and it is invisible from
  // the outside: a batch whose instance buffers are never freed keeps its GL memory for
  // the session, and a *shared* quad freed here leaves the next rebuild drawing a
  // disposed geometry. Three pieces cover the cases between them — the 货架 and the
  // 扶梯 are instanced batches, the 广告牌 and 电视 carry a shared lit quad.
  const killed = new Set()
  for (const value of Object.values(mats)) {
    for (const m of Array.isArray(value) ? value : [value]) m.addEventListener('dispose', () => killed.add(m))
  }
  let instanced = 0
  let shared = 0
  for (const label of ['货架', '扶梯', '广告牌 横版', '电视']) {
    const group = build(PIECES.find((p) => p[0] === label)[1]).group
    const meshes = []
    group.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
    const disposedGeometries = new Set()
    const disposedMeshes = new Set()
    for (const o of meshes) {
      o.geometry.addEventListener('dispose', () => disposedGeometries.add(o.geometry))
      o.addEventListener('dispose', () => disposedMeshes.add(o))
      if (o.isInstancedMesh) instanced++
      if (o.userData.sharedGeometry) shared++
    }
    disposeObject(group)
    for (const o of meshes) {
      if (o.userData.sharedGeometry) {
        assert.equal(disposedGeometries.has(o.geometry), false, `${label}: a shared quad keeps the geometry its owner still draws`)
      } else {
        assert.equal(disposedGeometries.has(o.geometry), true, `${label}: an owned geometry is freed`)
      }
      if (o.isInstancedMesh) {
        assert.equal(disposedMeshes.has(o), true, `${label}: an InstancedMesh is disposed itself, or its instance buffers leak`)
      }
    }
  }
  assert.ok(instanced > 0, 'the pieces under test draw instanced batches')
  assert.ok(shared > 0, 'and at least one shared lit quad')
  // The materials are the shared kit: a group never disposes them, because the next
  // rebuild (and every other piece in the station) still draws with them.
  assert.deepEqual([...killed], [], 'a group teardown never frees the shared material kit')
})

test('full-height platform doors seal the opening and carry their decals while sliding', () => {
  for (const side of ['left', 'right']) for (const stock of ['A', 'B', 'C', 'L']) {
    const mod = { id: 'psd-seals', type: 'platform-edge', x: 0, y: 0, z: 0, w: 24, cfg: { line: LINE.id, dir: 'up', side, psd: 'full' } }
    ctx.data = { ...data, lines: [{ ...LINE, stock }], modules: [mod] }
    const group = buildModule(mod, ctx)
    const leaves = group.userData.doors
    const glazing = leaves.filter((o) => o.name === 'psd-door-glass')
    assert.ok(glazing.length >= 2)
    for (let i = 0; i < glazing.length; i += 2) {
      const left = glazing[i], right = glazing[i + 1]
      const leftW = left.geometry.parameters.width, rightW = right.geometry.parameters.width
      const seam = left.position.x + leftW / 2
      assert.ok(Math.abs(seam - (right.position.x - rightW / 2)) < 1e-6, 'closed leaves meet without a centre opening')
      assert.ok(Math.abs(right.position.x + rightW / 2 - (left.position.x - leftW / 2) - (STOCK[stock].doorWidth * 1.5 * 0.98 + 0.4)) < 1e-6, 'scaled screen glazing overlaps both fixed pockets by 20 cm')
      const bottom = left.position.z - left.geometry.parameters.height / 2
      assert.ok(Math.abs(bottom - 1) < 1e-6, 'glazing meets the sill')
      assert.ok(Math.abs(left.position.z + left.geometry.parameters.height / 2 - 3.35) < 1e-6, 'glazing meets the header')
    }
    const decals = leaves.filter((o) => o.geometry.type === 'PlaneGeometry' && o.name !== 'psd-door-glass')
    assert.equal(decals.length, glazing.length * 3, 'each leaf carries a band, warning and opening arrow')
    const closed = leaves.map((o) => o.position.x)
    setDoors(group, 1)
    leaves.forEach((o, i) => assert.ok(Math.abs(o.position.x - closed[i] - o.userData.openSign * STOCK[stock].doorWidth * 1.5 * trainScaleForStorey() / 2) < 1e-6, 'frames and vinyl clear the scaled opening with the glazing'))
    setDoors(group, 0)
    leaves.forEach((o, i) => assert.equal(o.position.x, closed[i], 'closing restores the seal'))
    disposeObject(group)
  }
})

test('the pieces whose numbers come from the sim use the sim’s numbers', () => {
  // These are the values two modules have to agree on. A renderer that keeps its own
  // copy of one is a piece that stops matching the station the crowd walks.
  assert.equal(round(HALF_WALL_T), 0.5, 'a room panel is the half-block wall the 切角 tile lays')
  assert.ok(PSD_FULL_HEIGHT > PSD_HALF_HEIGHT, 'the two screen heights the graph reserves')
  assert.ok(STAIR_RUN > 0 && STAIR_RISE > 0, 'a flight runs and climbs, and the model draws both')
})


test('Tanwei B and snapped exits open under the actual 1/2/3 m stair band in every rotation', async () => {
  const { snapExitToRamp, exitRunOpenings } = await import('../src/sim/exits.ts')
  const { stairFlightSlides } = await import('../src/sim/stairs.ts')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/tanwei-exit-b.json', import.meta.url), 'utf8'))
  const cases = [fixture]
  for (let rot = 0; rot < 4; rot++) for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]) {
    const stair = createModule('stair-straight', -1, 40, -4, `band-${rot}-${width}`, rot, width)
    const exit = snapExitToRamp({ ...fixture.exit, cfg: { ...fixture.exit.cfg, bays: 3 } }, stair)
    cases.push({ stair, exit })
  }
  const previous = ctx.data
  try {
    for (const { stair, exit } of cases) {
      ctx.data = { ...data, modules: [exit, stair] }
      const portal = buildModule(exit, ctx), stairs = buildModule(stair, ctx)
      portal.updateMatrixWorld(true); stairs.updateMatrixWorld(true)
      const upper = stair.from.z > stair.to.z ? stair.from : stair.to
      const lower = stair.from.z < stair.to.z ? stair.from : stair.to
      const slide = stairFlightSlides(stair)[0]
      const centre = new THREE.Vector3(upper.x + 0.5 + slide.dx, upper.y + 0.5 + slide.dy, upper.z + 1)
      const uphill = new THREE.Vector3(upper.x - lower.x, upper.y - lower.y, 0).normalize()
      const right = new THREE.Vector3(uphill.y, -uphill.x, 0)
      const half = exitRunOpenings([stair], exit)[0].half
      const stairCentre = box(stairs).getCenter(new THREE.Vector3())
      assert.ok(Math.abs(stairCentre.dot(right) - centre.dot(right)) < 1e-6, 'probes follow the real rendered stair centerline')
      const pads = []
      portal.traverse((o) => { if (o.name === 'exit-concrete-base') pads.push(o) })
      const floorAt = (across) => {
        const point = centre.clone().addScaledVector(uphill, -1).addScaledVector(right, across)
        point.z = exit.z + 3
        return new THREE.Raycaster(point, new THREE.Vector3(0, 0, -1)).intersectObjects(pads, false).length > 0
      }
      for (const across of [-half + 0.05, 0, half - 0.05]) {
        assert.equal(floorAt(across), false, `${stair.id}: concrete must not cover either edge or the centre of the flight`)
      }
      for (const across of [-half - 0.05, half + 0.05]) {
        assert.equal(floorAt(across), true, `${stair.id}: concrete remains immediately outside both rails`)
      }
      disposeObject(portal); disposeObject(stairs)
    }
  } finally { ctx.data = previous }
})

test('raised concrete exits meet connected runs without covering escalator terminal tracks', async () => {
  const { exitRunSnap } = await import('../src/sim/exits.ts')
  const { escalatorRun } = await import('../src/sim/escalators.ts')
  const { EXIT_BASE_HEIGHT, exitLandingHeight } = await import('../src/render/models/pieces/ExitLanding.ts')
  for (let rot = 0; rot < 4; rot++) for (const covered of [true, false]) {
    const exit = { id: 'raised-exit', type: 'exit', x: 0, y: 0, z: 0, rot, cfg: { bays: 3, covered } }
    const snap = exitRunSnap([exit], 0, 0, 0)
    for (const width of [1, 2, 3]) for (const dir of ['up', 'down']) {
      const run = createModule('escalator', snap.base.x, snap.base.y, snap.base.z, 'run', snap.rot, width, dir)
      ctx.data = { ...data, modules: [exit, run] }
      const original = JSON.stringify(run)
      const portal = buildModule(exit, ctx)
      const escalator = buildModule(run, ctx)
      portal.updateMatrixWorld(true)
      const floor = exit.z + 1
      const pads = []
      portal.traverse((o) => { if (o.name === 'exit-concrete-base') pads.push(o) })
      assert.ok(pads.length >= 4)
      assert.equal(pads[0].material, ctx.finish('floor.concrete'))
      assert.equal(round(box(pads[0]).max.z), floor + EXIT_BASE_HEIGHT)
      assert.equal(round(box(pads[1]).max.z), floor + EXIT_BASE_HEIGHT / 2)
      assert.equal(round(box(pads[1]).min.z), floor)
      assert.ok(pads[0].geometry.getAttribute('color'), 'concrete supports finish vertex colours')
      assert.ok(pads[0].geometry.getAttribute('uv'), 'concrete uses metre-scaled texture UVs')
      const centred = escalatorRun(run)
      const top = centred.from.z > centred.to.z ? centred.from : centred.to
      assert.equal(exitLandingHeight([exit], top), EXIT_BASE_HEIGHT)
      assert.equal(exitLandingHeight([{ ...exit, cfg: { style: 'doorway' } }], top), 0)
      escalator.updateMatrixWorld(true)
      const roll = escalator.userData.escalator
      const terminal = roll.parts[0].localToWorld(roll.climb.clone().multiplyScalar(roll.inclineLen))
      assert.equal(round(terminal.z), floor + EXIT_BASE_HEIGHT, 'moving track reaches the raised landing')
      const decks = []
      escalator.traverse((o) => { if (o.name === 'landing-deck') decks.push(o) })
      assert.equal(round(Math.max(...decks.map((o) => box(o).max.z))), round(floor + EXIT_BASE_HEIGHT + ESCALATOR_SURFACE_CLEARANCE))
      for (const pad of pads) {
        const b = box(pad)
        // Probe the track at the centre and just before the upper comb.
        for (const distance of [0, 0.15]) {
          const point = roll.parts[0].localToWorld(roll.climb.clone().multiplyScalar(roll.inclineLen).add(new THREE.Vector3(roll.climb.x, roll.climb.y, 0).normalize().multiplyScalar(distance)))
          assert.equal(b.containsPoint(point), false, 'concrete leaves upper moving treads clear')
        }
      }
      assert.equal(JSON.stringify(run), original, 'render offsets preserve graph and module endpoints')
      disposeObject(portal); disposeObject(escalator)
    }
    const stair = createModule('stair-straight', snap.base.x, snap.base.y, snap.base.z, 'stair', snap.rot)
    ctx.data = { ...data, modules: [stair] }
    const plain = buildModule(stair, ctx)
    ctx.data = { ...data, modules: [exit, stair] }
    const raised = buildModule(stair, ctx)
    assert.equal(round(box(raised).max.z - box(plain).max.z), EXIT_BASE_HEIGHT, 'stair and its top rail meet the raised pad')
    assert.equal(raised.children[0].position.z, plain.children[0].position.z, 'lower stair landing stays on its floor')
    disposeObject(plain); disposeObject(raised)
  }
})


test('PSD sections keep track-side leaves, cadence pillars and gapless closed glazing', () => {
  for (const height of ['full', 'half']) for (const side of ['left', 'right']) for (const rot of [0, 1, 2, 3]) {
    const { group } = build({ ...edge(height, side), w: 30, rot })
    const toward = side === 'right' ? 1 : -1
    const fixed = group.getObjectByName('psd-fixed-glass')
    const panes = group.userData.doors.filter(o => o.name === 'psd-door-glass')
    const pillars = group.children.filter(o => o.name === 'psd-section-pillar')
    assert.equal(pillars.length, panes.length / 2 + 1)
    for (let i = 0; i < panes.length; i += 2) {
      const a = panes[i], b = panes[i + 1]
      assert.ok((a.position.y - fixed.position.y) * toward > 0)
      assert.ok(Math.abs(a.position.x + a.geometry.parameters.width / 2 - b.position.x + b.geometry.parameters.width / 2) < 1e-6)
      if (i > 0) assert.ok(Math.abs(pillars[i / 2].position.x - (panes[i - 2].position.x + panes[i - 1].position.x + a.position.x + b.position.x) / 4) < 1e-6)
    }
    const yellow = group.getObjectByName('platform-yellow-line')
    assert.ok((fixed.position.y - yellow.position.y) * toward > 0)
    assert.equal(yellow.userData.wall, undefined)
    disposeObject(group)
  }
  for (const rot of [0, 1, 2, 3]) {
    const { group } = build({ ...edge('none'), rot })
    assert.equal(group.children.length, 1)
    assert.equal(group.children[0].name, 'platform-yellow-line')
    assert.equal(group.userData.doors, undefined)
    disposeObject(group)
  }
})


test('PSD thresholds are flush, meeting stiles are black and fixed pillars meet the sliding glass without side gaps', () => {
 for (const height of ['half','full']) for (const side of ['left','right']) for (const rot of [0,1,2,3]) {
  const {group}=build({...edge(height,side),rot})
  assert.ok(Math.abs(box(group.getObjectByName('psd-threshold')).max.z-1)<1e-6)
  const threshold=group.getObjectByName('psd-threshold')
  const thresholdBox=box(threshold)
  const foundation=group.getObjectByName('psd-concrete-foundation'), foundationBox=box(foundation)
  assert.ok(Math.abs(foundationBox.max.z-thresholdBox.min.z)<1e-6,'concrete touches the sill underside')
  assert.ok(Math.abs(foundationBox.min.z)<1e-6,'concrete fills only the 1 m block the PSD sits on')
  for(const axis of ['x','y'])assert.ok(Math.abs(foundationBox.min[axis]-thresholdBox.min[axis])<1e-6&&Math.abs(foundationBox.max[axis]-thresholdBox.max[axis])<1e-6,'foundation supports the complete sill footprint')
  for(const t of [0,.5,1]) {
   setDoors(group,t)
   for(const leaf of group.userData.doors) {
    const bounds=box(leaf)
    const axis=rot%2===0?'y':'x'
    assert.ok(bounds.min[axis] >= thresholdBox.min[axis]-1e-6 && bounds.max[axis] <= thresholdBox.max[axis]+1e-6,'sill reaches under the full depth of the sliding doors')
   }
  }
  setDoors(group,0)
  const panes=group.userData.doors.filter(p=>p.name==='psd-door-glass')
  const stiles=group.userData.doors.filter(p=>p.name==='psd-door-meeting-frame')
  assert.equal(stiles.length,panes.length)
  for(const stile of stiles)assert.equal(stile.material,mats.black)
  const toward=side==='right'?1:-1
  for(const jamb of group.children.filter(p=>p.name==='psd-fixed-post' || p.name==='psd-section-pillar')) {
   const end=jamb.position.y+toward*jamb.geometry.parameters.height/2
   assert.ok(Math.abs(end-panes[0].position.y)<1e-8,'fixed pillar back face meets the moving glass plane with zero side gap')
  }
  const stileOffsets=stiles.map((stile,i)=>stile.position.x-panes[i].position.x)
  for(const t of [0,.5,1]) {
   setDoors(group,t)
   stiles.forEach((stile,i)=>assert.ok(Math.abs(stile.position.x-panes[i].position.x-stileOffsets[i])<1e-8,'meeting frames remain attached to their glass through the slide'))
  }
  if(height==='half')for(const sticker of group.children.filter(p=>p.name==='psd-fixed-sticker'))assert.ok((panes[0].position.y-sticker.position.y)*toward>0.10,'stickers stay outside the pillar face without coplanar flicker')
  if(height==='half')for(const part of group.children.filter(p=>['psd-fixed-rail','psd-fixed-cap','half-door-rail','half-door-cap','psd-fixed-post','psd-section-pillar'].includes(p.name)))assert.equal(part.material,mats.black)
  disposeObject(group)
 }
 for(const rot of [0,1,2,3]) {
  const {group}=build({...track({}),rot})
  const scale = trainScaleForStorey()
  const bedTop = (0.45 - TRACK_BED_DROP) * scale + trainOriginForScale(scale) - (1 - 0.62) * scale
  assert.ok(Math.abs(box(group.getObjectByName('track-bed')).max.z - bedTop)<1e-6,'bed is recessed beneath the platform to accommodate the full underfloor height')
  disposeObject(group)
 }
})


test('single cantilever masts share third-rail side selection across PSD banks, directions and rotations',()=>{
 for(const dir of ['up','down'])for(const rot of [0,1,2,3])for(const d of [3,4])for(const bridge of [false,true]) {
  for(const banks of [[],['left'],['right'],['left','right'],['none-left','right']]) {
   const rail={...track({power:'catenary',catenaryStyle:'gantry',dir,bridge}),rot,d,w:17}
   const edges=banks.map((bank,i)=>({id:`screen-${i}`,type:'platform-edge',x:4,y:4,z:0,w:17,rot,cfg:{line:'5',from:rail.id,dir,side:bank==='none-left'?'left':bank,psd:bank==='none-left'?'none':'half'}}))
   const present=banks.filter(b=>b!=='none-left')
   const expected=bridge||present.length!==1?(dir==='up'?-1:1):(present[0]==='left'?-1:1)
   const group=buildModule(rail,{...ctx,data:{...data,modules:[rail,...edges]}})
   group.updateMatrixWorld(true)
   const posts=group.children.filter(o=>o.name===(bridge?'bridge-gantry-post':'station-gantry-post'))
   assert.equal(posts.length,3,'one mast per eight-metre support interval')
   for(const post of posts){const world=post.getWorldPosition(new THREE.Vector3());const local=group.worldToLocal(world);assert.ok(Math.abs(local.y-(d-1)/2-expected*(d/2+.16))<1e-6,'mast follows the actual PSD-free side or travel right fallback')}
   assert.equal(group.children.filter(o=>o.name==='catenary-cantilever-arm').length,posts.length)
   disposeObject(group)
  }
 }
})


test('wide D stock clears bridge railings and platform cantilever masts even on legacy narrow beds',()=>{
 for(const d of [3,4])for(const bridge of [false,true])for(let rot=0;rot<4;rot++){
  const mod=track({bridge,power:'catenary',catenaryStyle:'gantry',bridgeRailing:'railing'});mod.d=d;mod.rot=rot
  const edge={id:'wide-platform',type:'platform-edge',x:0,y:d,z:mod.z,w:mod.w,rot,cfg:{from:mod.id,line:LINE.id,side:'left',psd:'half',dir:'up'}}
  const modules=bridge?[mod]:[mod,edge]
  const group=buildModule(mod,{...ctx,data:{...data,lines:[{...LINE,stock:'D'}],modules}})
  try{
   group.rotation.z=0;group.position.set(0,0,0);group.updateMatrixWorld(true)
   const centre=trackTrainCentreV(mod,STOCK.D.width,bridge?[]:[edge])-.5
   const fixtures=[];group.traverse(p=>{if(['bridge-railing-post','bridge-railing-top','bridge-gantry-post','station-gantry-post'].includes(p.name))fixtures.push(p)})
   assert.ok(fixtures.length)
   for(const part of fixtures){
    const box=new THREE.Box3().setFromObject(part)
    assert.ok(box.max.y<centre-STOCK.D.width/2-.02||box.min.y>centre+STOCK.D.width/2+.02,`${part.name} remains outside the wide car body`)
   }
  }finally{disposeObject(group)}
 }
})
