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
const { STOCK, doorCentres } = await import('../src/sim/stock.ts')
const { STAIR_RISE, STAIR_RUN } = await import('../src/sim/stairs.ts')
const { ESCALATOR_SPEED, ESCALATOR_BALUSTRADE, HALF_WALL_T, PSD_FULL_HEIGHT, PSD_HALF_HEIGHT } = await import('../src/sim/constants.ts')
const { RAMP_FOOT } = await import('../src/sim/openings.ts')
const { DOOR_SPECS } = await import('../src/sim/doors.ts')

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#c8102e',
  stock: 'B',
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
 * real module resolves its JPEGs with Vite's `import.meta.glob`, which plain Node has
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

const palette = (id, rot = 0, dir = 'up', door = 'lane') => createModule(id, 4, 4, 0, 'm-' + id, rot, undefined, dir, door, [LINE])
/**
 * A 站名 is cut from the **station's name**, not from its palette id, so it is
 * built through the whole document (`data.name` is 动物园 here): its panel is three
 * cells wide for a three-character name, which is the number the row below pins.
 */
const calligraphy = (id) => createModule(id, 4, 4, 0, 'm-' + id, 0, undefined, 'up', 'lane', data)
const room = (type, kind, extra = {}) => ({ id: `${type}-1`, type, x: 4, y: 4, z: 0, w: 5, h: 4, rot: 0, cfg: { kind, door: [[6, 4]], ...extra } })
const edge = (psd, side = 'left', dir = 'up') => ({ id: `edge-${psd}`, type: 'platform-edge', x: 4, y: 4, z: 0, w: 8, rot: 0, cfg: { name: '站台门', line: '5', dir, side, psd, from: 'track-1' } })
const track = (cfg) => ({ id: 'track-1', type: 'track', x: 4, y: 4, z: 0, w: 8, d: 3, rot: 0, cfg: { line: '5', power: 'third-rail', dir: 'up', ...cfg } })

/**
 * One row per piece: the label, the module, the meshes it draws and the size its
 * bounding box spans in metres. The count is exact on purpose — a part that stops
 * being built is invisible in every other way.
 */
const PIECES = [
  ['闸机 lane', palette('gate'), 31, '1×0.986×1.25'],
  ['闸机 fence', palette('gate', 0, 'up', 'fence'), 36, '1.04×0.986×1.25'],
  ['围栏', palette('fence'), 9, '1.08×0.16×1'],
  ['售票机', palette('tvm'), 14, '0.8×0.665×1.87'],
  ['自动贩卖机', palette('vending'), 58, '0.78×0.701×1.88'],
  ['座椅 不锈钢 1m', palette('bench-steel-1'), 7, '0.9×0.415×0.49'],
  ['座椅 不锈钢 2m', palette('bench-steel-2'), 7, '1.9×0.415×0.49'],
  ['座椅 靠背 1m', palette('bench-seat-1'), 13, '1.04×0.685×1.105'],
  ['座椅 连排 2m', palette('bench-seat-2'), 21, '2.04×0.685×1.105'],
  ['货架', palette('shelf'), 20, '0.99×0.5×1.9'],
  ['办公桌', palette('desk'), 5, '1.1×0.95×0.77'],
  ['厕所隔间', palette('cubicle'), 3, '0.71×1×1.8'],
  ['洗手池', palette('sink'), 2, '0.6×0.5×0.36'],
  ['垃圾桶', palette('bin'), 18, '0.88×0.433×0.95'],
  ['灭火器', palette('extinguisher'), 13, '0.743×0.487×1.1'],
  ['时钟', palette('clock'), 131, '0.8×0.236×1.05'],
  ['监控', palette('cctv'), 14, '0.298×0.429×0.463'],
  ['广告牌 横版', palette('billboard-wide'), 5, '0.98×0.185×0.86'],
  ['广告牌 标准', palette('billboard-standard'), 5, '1.84×0.185×1.14'],
  ['广告牌 大横版', palette('billboard-large'), 5, '1.98×0.185×1.33'],
  ['广告牌 长幅', palette('billboard-panorama'), 5, '2.94×0.185×1.13'],
  ['广告牌 竖版', palette('billboard-portrait'), 5, '0.92×0.185×1.54'],
  ['广告牌 方形', palette('billboard-square'), 5, '0.92×0.185×1.18'],
  ['电视', palette('tv'), 13, '1.56×0.16×1.32'],
  ['指示牌 吊挂', palette('sign-ceiling'), 7, '2.15×0.16×1'],
  ['指示牌 墙面', palette('sign-wall'), 3, '2.15×0.197×0.7'],
  // The wall pieces (§5.7). A 玻璃板 is the outer frame and one pane whatever its
  // size — five meshes for a 1 × 1 band and for a 3 × 2 window alike, which is what
  // "no inner frame" means as a number. A 站名 is its single ink plane, cut to the
  // panel the name asked for. A 线网图 is a framed board, or a totem with a plinth, a
  // post and a lit face on each side — the **same two-cell board** on both mounts.
  ['玻璃板 1×1', palette('glass-1x1'), 5, '1×0.1×1'],
  ['玻璃板 3×1', palette('glass-3x1'), 5, '3×0.1×1'],
  ['玻璃板 3×2', palette('glass-3x2'), 5, '3×0.1×2'],
  // The 门 (§5.7) is a **free-standing doorway** — threshold, two posts, head and the
  // leaves hung between them — so it stands on a floor tile and needs no wall. Nine
  // meshes for a 单开 (four frame members plus the leaf's own five) and fourteen for a
  // 双开, so the leaf count is a number the model really draws.
  ['门 单开 不锈钢', palette('door-steel-1'), 9, '1×0.19×2.05'],
  ['门 双开 不锈钢', palette('door-steel-2'), 14, '2×0.19×2.05'],
  ['门 单开 木', palette('door-wood-1'), 9, '1×0.19×2.05'],
  ['门 双开 木', palette('door-wood-2'), 14, '2×0.19×2.05'],
  ['站名 楷书 横排', calligraphy('calligraphy-kai-h'), 1, '3×0×1'],
  ['站名 楷书 竖排', calligraphy('calligraphy-kai-v'), 1, '0.98×0×2.6'],
  ['线网图 墙面', palette('linemap-wall'), 3, '1.92×0.185×1.939'],
  ['线网图 立式', palette('linemap-stand'), 5, '1.86×0.62×2.279'],
  ['出入口 有盖 单向', palette('exit-covered-1'), 75, '3.1×8.118×3.75'],
  ['出入口 有盖 双向', palette('exit'), 75, '4.1×8.118×3.75'],
  ['出入口 有盖 三向', palette('exit-covered-3'), 75, '5.1×8.118×3.75'],
  ['出入口 无盖 单向', palette('exit-uncovered-1'), 44, '3.04×8.08×1'],
  ['出入口 无盖 双向', palette('exit-uncovered-2'), 46, '4.04×8.08×1'],
  ['出入口 无盖 三向', palette('exit-uncovered-3'), 46, '5.04×8.08×1'],
  ['扶梯', palette('escalator'), 18, '0.98×7.55×5.563'],
  ['电梯', palette('lift'), 17, '2.04×2.04×6.73'],
  // The 楼梯 pieces stand in the corner of the fixture's walled room, so the wall columns
  // around them are read: a flight or half-landing a wall hugs loses that side's balustrade
  // (`stairWallSides` / `stairLandingWalls`). In the open, a 90° turn draws 90 meshes and a
  // 双跑楼梯 93 — the rows below are the same pieces with a room's wall against the turn.
  //
  // The height is the stringer's and soffit's **square-cut corners**, not an overhang: both
  // beams are trimmed by `thickness · tan θ` so they end on the treads' own edge, inside the
  // cell the cut shaves. An overhang put the piece's lowest point 0.36 m deep in the landing's
  // block, which is deliberately never cut — the flight's foot sank into the floor it stands on.
  ['楼梯 单跑', palette('stair-straight'), 71, '0.89×6.25×5.323'],
  ['楼梯 左转 90°', palette('stair-left90'), 87, '3.57×3.57×5.315'],
  ['楼梯 右转 90°', palette('stair-right90'), 90, '3.57×3.57×5.315'],
  ['楼梯 左双跑', palette('stair-left180'), 90, '2×3.625×5.315'],
  ['楼梯 右双跑', palette('stair-right180'), 90, '2×3.625×5.315'],
  ['售票亭', { id: 'booth-1', type: 'booth', x: 4, y: 4, z: 0, w: 3, h: 3, rot: 0, cfg: { kind: 'ticket' } }, 20, '3×3×2.03'],
  ['商店房间', room('shop', 'store'), 18, '5×4×3'],
  // 厕所 / 办公室 close their doorway with the shared 门 builder
  // (`render/models/pieces/DoorModel.ts`): the same standing doorway — threshold, posts,
  // head and the leaf between them — set into the opening they cut, so the room's box
  // grows by the threshold's own step past the wall's face and nothing more.
  ['厕所房间', room('shop', 'toilet'), 27, '5×4.09×3'],
  ['办公室房间', room('shop', 'office'), 27, '5×4.09×3'],
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

test('a piece the palette cannot lay draws nothing, and says so by returning null', () => {
  assert.equal(buildModule({ id: 'x', type: 'wall', x: 0, y: 0, z: 0, rot: 0, cfg: {} }, ctx), null)
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

test('the sizes that are contracts hold, and not just the numbers above', () => {
  // The 闸机 is the reference's 1250 mm machine, not a 1 m cube.
  assert.equal(round(box(build(palette('gate')).group).getSize(new THREE.Vector3()).z), 1.25)

  // A screen door is drawn to the height the graph reserves for it, so the glass the
  // player sees is the barrier the crowd queues behind.
  const full = box(build(edge('full')).group).getSize(new THREE.Vector3()).z
  const half = box(build(edge('half')).group).getSize(new THREE.Vector3()).z
  assert.ok(Math.abs(full - PSD_FULL_HEIGHT) < 0.1, `全高 is drawn to PSD_FULL_HEIGHT (${round(full)} vs ${PSD_FULL_HEIGHT})`)
  assert.ok(Math.abs(half - PSD_HALF_HEIGHT) < 0.1, `半高 is drawn to PSD_HALF_HEIGHT (${round(half)} vs ${PSD_HALF_HEIGHT})`)

  // An exit widens by exactly one block per bay; the 无盖 variant trades the canopy
  // for a glass railing over the same plan.
  const width = (id) => round(box(build(palette(id)).group).getSize(new THREE.Vector3()).x)
  assert.deepEqual([width('exit-covered-1'), width('exit'), width('exit-covered-3')], [3.1, 4.1, 5.1], '有盖: 单向 / 双向 / 三向 are 3 / 4 / 5 blocks across')
  assert.deepEqual([width('exit-uncovered-1'), width('exit-uncovered-2'), width('exit-uncovered-3')], [3.04, 4.04, 5.04], '无盖: the same plan under a railing')
  assert.ok(box(build(palette('exit-uncovered-2')).group).getSize(new THREE.Vector3()).z < 1.1, 'and 无盖 has no roof to stand on')

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
  const pair = doorSize('door-steel-2')
  assert.ok(Math.abs(single.z - 2.05) < 1e-6, `a 门 is drawn to its own height (${round(single.z)})`)
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
  assert.ok(Math.abs(oneLeaf.size.z - 2.05) < 1e-6, `a room doorway is cut to the 门 piece's own height (${round(oneLeaf.size.z)})`)
  assert.ok(Math.abs(oneLeaf.size.x - single.x) < 1e-6, 'and a one-cell opening draws one leaf of it')
  assert.equal(oneLeaf.meshes, 9, 'a doorway draws exactly the parts a standing 门 does')
  const twoLeaves = roomDoor([
    [6, 4],
    [7, 4],
  ])
  assert.ok(Math.abs(twoLeaves.size.x - pair.x) < 1e-6, 'a two-cell opening draws the pair')
  // The fittings are one set per leaf and nothing else, so the extra meshes are the
  // second leaf's own five — the same five a 双开 门 adds over a 单开.
  assert.equal(twoLeaves.meshes - oneLeaf.meshes, 5, 'the second leaf adds its own five parts')

  // 供电: 接触网 hangs a wire overhead, 第三轨 guards a conductor rail at track level.
  const rail = box(build(track({ power: 'third-rail' })).group).getSize(new THREE.Vector3())
  const wire = box(build(track({ power: 'catenary' })).group).getSize(new THREE.Vector3())
  assert.equal(round(rail.x), 8, 'a rail is exactly as long as its run')
  assert.ok(wire.z > rail.z * 3, 'the catenary reaches over the train; the third rail does not')
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

  // The 指示牌's two mounts are one board hung two ways. The **wall** board is bolted
  // flat to its wall — its body's back face is the cell's own −y edge (the plane a wall
  // block's face is at, local y = −0.5), so the panel stands on the wall rather than
  // floating in front of it — and it hangs at reading height with no rods, while the
  // overhead board reaches the storey slab it is suspended from. Every box is in world
  // metres and the piece stands on a block top at z = 1, so the heights below are read
  // back off it.
  const wallSign = box(build(palette('sign-wall')).group)
  const hungSign = box(build(palette('sign-ceiling')).group)
  assert.equal(round(wallSign.min.y), 4, 'the wall board is flush with the wall plane')
  assert.ok(wallSign.max.y - wallSign.min.y < 0.25, 'and stands only its own body proud of it')
  assert.equal(round(wallSign.min.z - 1), 1.3, 'the wall board hangs at the eye height its courses name')
  assert.equal(round(wallSign.max.z - 1), 2, 'and its panel crosses exactly the one wall course it asks for')
  assert.ok(hungSign.max.z - 1 > 2.9, 'a 吊挂 board reaches the ceiling its rods bolt to')
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
  assert.equal(round(b.min.z), mod.from.z + 1, 'it does not stand on the lower landing’s floor')
  assert.equal(round(b.min.y), round(mod.from.y + 0.5 + 0.75), 'it does not start where the lid meets the floor')
  assert.equal(round(b.max.y), round(mod.from.y + 0.5 + 2.5), 'it does not finish on the cell edge it crosses')
  assert.equal(round(b.max.z), round(cutAt(b.max.y)), 'its top is not the plane the ground is shaved to')
  assert.ok(b.max.z > mod.from.z + 1 + 1, 'its lid flattens off at the course line instead of following the ground up')
  assert.equal(round(b.getSize(new THREE.Vector3()).x), round(ESCALATOR_BALUSTRADE), 'not flush with the truss box’s flanks')

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
  for (const s of [1, 1.5, 2, 2.4]) assert.equal(under(s), 'undercroft', `nothing solid under the run ${s} m up from the landing`)
  for (const s of [3.5, 4.5, 5.5]) assert.notEqual(under(s), 'undercroft', `the body reaches past the course the ground stops at (${s} m)`)

  // Its lid **is** that plane, to the body's very end: the body and the shaved ground meet in one
  // surface instead of leaving a step beside the run or a slit at the trench the cut opens at its
  // foot — and its top is buried in the truss box the whole way, so no slit opens under the truss
  // where a flat cap would have stopped short of it. Nothing may stand proud of the plane: a
  // vertex above it would poke through the ground the player sees.
  let worst = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(solid.matrixWorld)
    worst = Math.max(worst, v.z - cutAt(v.y))
  }
  assert.ok(Math.abs(worst) < 1e-6, `the body is ${worst.toFixed(4)} m off the plane the ground is shaved to`)

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
    assert.ok(size.x > length && size.x < length + 1.5, `${stock}: body is cars × carLength (${round(size.x)} vs ${round(length)})`)
    // The body is the stock's own width; lamp housings and marker bars reach a hair past it.
    assert.ok(size.y >= s.width && size.y < s.width + 0.2, `${stock}: the body is the stock's width (${round(size.y)} vs ${s.width})`)
    // One leaf per modelled door, and every door has two leaves a side.
    const cadence = doorCentres({ stock, cars: pose.cars })
    assert.equal(g.userData.doors.length, cadence.length * 4, `${stock}: every door has two leaves a side`)
    assert.equal(g.userData.ownedMats.length, 1, `${stock}: the consist owns the livery it minted`)

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
  const wing = gate.userData.wing
  const fullW = wing.userData.fullW
  const edgeX = wing.userData.edgeX
  const hinge = () => round(wing.position.x - (fullW * wing.scale.x) / 2)
  setGateWing(gate, 0)
  assert.equal(round(wing.scale.x), 1, 'shut: the leaf is its full length')
  assert.equal(hinge(), round(edgeX), 'and its hinge sits on the machine face')
  setGateWing(gate, 1)
  assert.ok(wing.scale.x < 0.2, 'open: the leaf is compressed into the panel')
  assert.equal(hinge(), round(edgeX), 'while the hinge end never moves')
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

test('the pieces whose numbers come from the sim use the sim’s numbers', () => {
  // These are the values two modules have to agree on. A renderer that keeps its own
  // copy of one is a piece that stops matching the station the crowd walks.
  assert.equal(round(HALF_WALL_T), 0.5, 'a room panel is the half-block wall the 切角 tile lays')
  assert.ok(PSD_FULL_HEIGHT > PSD_HALF_HEIGHT, 'the two screen heights the graph reserves')
  assert.ok(STAIR_RUN > 0 && STAIR_RISE > 0, 'a flight runs and climbs, and the model draws both')
})
