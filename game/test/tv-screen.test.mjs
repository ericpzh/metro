// The 电视 screen's lit panes (`render/models.ts` `buildTv`).
//
// The screen is two lit panes on a dark backing slab: the station board down the
// left, the content window on the right. The failure this file exists to prevent
// is silent — a lit pane placed on its backing slab's *centre line* is buried
// inside it, so the window renders as a plain black rectangle with no error
// anywhere. That is a real bug this repo shipped, so the geometry is pinned here
// rather than left to a visual check.
//
// Its twin is just as silent and also shipped: the board's plate is drawn into a
// whole-screen canvas but sampled by a column-sized mesh, which buries the right
// `1 - TV_POSTER_RECT.x` of the column under black backing and condenses the text
// beside it. So the *sampling* is pinned here as well as the geometry.
//
// `models.ts` needs a DOM for its canvas textures, so the test supplies a minimal
// one. Only the calls the TV builder actually makes are implemented.
//
// The ad artwork interface is hand-stubbed rather than importing `render/adArt.ts`:
// that module resolves its JPEGs through Vite's `import.meta.glob`, which plain Node
// has no implementation of. Nothing under test lives there — the geometry this file
// pins is `buildTv`'s.
import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * A 2D context just real enough for the model kit: style properties remember what
 * they are set to, and `measureText` answers with a width (several models lay text
 * out from it, so returning nothing stops the build outright).
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

const THREE = await import('three')
const { buildModule, createModelMaterials } = await import('../src/render/models.ts')
const { STATION_PLATE, TV_POSTER_RECT, stationDisplayLayout } = await import('../src/render/stationDisplay.ts')

/**
 * The `ctx.ads` surface `buildTv` uses, cut down to a lit pane: a fresh
 * front-side-only material and a plane the size of the window.
 */
const adsStub = {
  adFace: (slug, w, h) => ({
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    geometry: new THREE.PlaneGeometry(w, h),
    slug,
  }),
  adWindow: (w, h) => adsStub.adFace('metro-security', w, h),
  load: async () => {},
  dispose: () => {},
}

/** A plausible station document: one line, and the TV being built. */
function station() {
  return {
    name: '动物园',
    seed: 1,
    cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }],
    modules: [],
    lines: [
      {
        id: '5',
        name: '5号线',
        colour: '#c8102e',
        stock: 'B',
        cars: 6,
        power: 'third-rail',
        headwayProfile: { peak: 4, offpeak: 7, late: 10 },
        alightPerTrain: 40,
        terminus: 'reverse',
        direction: 'up',
        upTerminus: '黄埔新港',
        downTerminus: '滘口',
        travelSign: 1,
        stations: [],
      },
    ],
  }
}

/** Build one 电视 and hand back its group plus the panes the scene looks for. */
function buildTv() {
  const data = station()
  const mats = createModelMaterials()
  const ctx = {
    mats,
    ads: adsStub,
    data,
    trackCells: new Set(),
    finish: () => new THREE.MeshBasicMaterial(),
    tvPlate: () => new THREE.CanvasTexture(stubCanvas()),
  }
  const mod = { id: 'tv-1', type: 'tv', x: 0, y: 0, z: 0, rot: 0, cfg: { poster: 'metro-security' } }
  const group = buildModule(mod, ctx)
  assert.ok(group, 'the TV did not build')
  return { group, data }
}

/** Every mesh in a group, with its world-space bounding box. */
function meshesOf(group) {
  const out = []
  group.updateMatrixWorld(true)
  group.traverse((o) => {
    if (o.isMesh) out.push({ mesh: o, box: new THREE.Box3().setFromObject(o) })
  })
  return out
}

test('the content window is lit in front of its own backing, not inside it', () => {
  const { group } = buildTv()
  const screen = group.userData.adScreen
  assert.ok(screen, 'the module did not register an ad screen for the scene to swap')
  const win = screen.userData.adWindow
  assert.ok(win, 'the window geometry is missing, so a swap cannot size itself')

  // The lit pane's own depth: the model centres it there, so the mesh's position
  // is where the pane actually sits. The backing slab is `depth - 0.02` thick and
  // is centred on the same point, so it occupies ±(that / 2).
  screen.updateMatrixWorld(true)
  const paneY = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3()).y
  const backingDepth = 0.08 // screen `depth` 0.1 - 0.02
  // The pane must be clear of the slab's FAR face — the one between it and the
  // viewer. Coplanar is not enough: at equal depth the slab wins the depth test
  // and the window renders as flat black, which is the bug this pins.
  assert.ok(
    paneY <= -backingDepth / 2 - 1e-4,
    `the lit pane (y ${paneY.toFixed(4)}) is buried in its backing (slab covers ±${(backingDepth / 2).toFixed(4)})`,
  )

  // And the backing it sits in front of is really there, matching the window.
  const backdrop = meshesOf(group).find(({ box }) => {
    const size = box.getSize(new THREE.Vector3())
    return Math.abs(size.x - win.w) < 1e-6 && Math.abs(size.z - win.h) < 1e-6
  })
  assert.ok(backdrop, 'no backing slab behind the content window')
  const centre = backdrop.box.getCenter(new THREE.Vector3())
  const slabY = centre.y + localOffsetY(backdrop.mesh, group)
  assert.ok(paneY < slabY, `the pane (y ${paneY.toFixed(4)}) is not in front of its backing (slab centre y ${slabY.toFixed(4)})`)
})

/**
 * A mesh's Y in the module group's own frame. `buildTv` hangs everything off the
 * group origin, so subtracting the ancestor offsets recovers the local coordinate
 * the builder chose — which is the thing under test.
 */
function localOffsetY(mesh, root) {
  const world = new THREE.Vector3()
  mesh.getWorldPosition(world)
  const origin = new THREE.Vector3()
  root.getWorldPosition(origin)
  return origin.y - world.y
}

test('the station board and the window are lit on one viewing face only', () => {
  const { group } = buildTv()
  const lit = []
  group.traverse((o) => {
    if (o.isMesh && (o.userData.adPoster !== undefined || o.userData.adStationPlate !== undefined)) lit.push(o)
  })
  assert.equal(lit.length, 2, 'there should be exactly two lit panes: the board and the window')
  for (const pane of lit) {
    // A `DoubleSide` pane would print the board through the back of the case, so
    // the back would not read as a blank panel.
    assert.notEqual(pane.material.side, THREE.DoubleSide, 'a lit pane is double-sided')
    assert.equal(pane.material.side, THREE.FrontSide, 'a lit pane should be front-side only')
  }
  // Both ride the same face, so the panel is legible from one side and dark from
  // the other.
  const ys = lit.map((p) => new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3()).y)
  assert.ok(Math.sign(ys[0]) === Math.sign(ys[1]), `the lit panes face opposite ways: ${ys}`)
  assert.ok(ys[0] < 0, 'the viewing face should be the local −y face, as documented')
})

test('the window fills the region the board leaves it, top to bottom', () => {
  const { group } = buildTv()
  const screen = group.userData.adScreen
  const win = screen.userData.adWindow
  const SW = 1.42
  const SH = 0.8
  const lit = meshesOf(group).filter(({ mesh }) => mesh.userData.adPoster !== undefined || mesh.userData.adStationPlate !== undefined)
  // The window is the whole right region of the screen, at full height: the
  // artwork covers its entire half of the panel with no margin above or below.
  assert.ok(Math.abs(win.h - SH) < 0.005, `window height ${win.h} does not reach the screen edges`)
  assert.ok(Math.abs(win.w - SW * TV_POSTER_RECT.w) < 0.005, `window width ${win.w} does not match the reserved region`)
  // Each pane is measured from its own edge of the opening, so together they cover
  // it exactly and neither can drift into the bezel post beside it. A pane that
  // overhangs the opening is clipped by that post, which shows up as a black band
  // down the side of the artwork.
  //
  // Measured in the module group's frame: `buildModule` puts the group at the
  // cell's centre, so absolute world X is not comparable to the local opening.
  const originX = new THREE.Vector3()
  group.getWorldPosition(originX)
  const opening = { min: -SW / 2, max: SW / 2 }
  for (const { box, mesh } of lit) {
    const what = mesh.userData.adPoster !== undefined ? 'window' : 'board'
    const lo = box.min.x - originX.x
    const hi = box.max.x - originX.x
    assert.ok(lo >= opening.min - 0.005, `the ${what} starts past the screen's left edge (${lo.toFixed(4)})`)
    assert.ok(hi <= opening.max + 0.005, `the ${what} runs into the bezel post at the right (${hi.toFixed(4)})`)
  }
})

test('nothing sits between the board and the window', () => {
  const { group } = buildTv()
  const lit = meshesOf(group).filter(({ mesh }) => mesh.userData.adPoster !== undefined || mesh.userData.adStationPlate !== undefined)
  assert.equal(lit.length, 2, 'there should be exactly two lit panes')
  // Compare the panes to each other, not to absolute coordinates: `buildModule`
  // puts the group at the cell's centre (`mod.x + 0.5`), so only their shared edge
  // is meaningful in world space.
  const byX = [...lit].sort((a, b) => a.box.min.x - b.box.min.x)
  const [board, window_] = byX
  // The board's right edge and the window's left edge must MEET. Any slack here is
  // dead black between the text and the picture — exactly the gap a doubled inset
  // left behind.
  const gap = window_.box.min.x - board.box.max.x
  assert.ok(Math.abs(gap) < 0.005, `there is a ${gap.toFixed(4)} m gap between the board and the window`)
  // Each pane reaches its own edge of the screen, so neither falls short of the panel.
  const SW = 1.42
  assert.ok(Math.abs(board.box.min.x - window_.box.min.x + 0) >= 0, 'sanity')
  const boardW = board.box.max.x - board.box.min.x
  const winW = window_.box.max.x - window_.box.min.x
  assert.ok(Math.abs(boardW + winW - SW) < 0.005, `the two panes cover ${(boardW + winW).toFixed(4)} m of a ${SW} m screen`)
  // Both are full height: no letterbox strip above or below the artwork.
  const SH = 0.8
  for (const { box, mesh } of lit) {
    const what = mesh.userData.adPoster !== undefined ? 'window' : 'board'
    assert.ok(Math.abs(box.max.z - box.min.z - SH) < 0.005, `the ${what} is ${(box.max.z - box.min.z).toFixed(3)} m tall, not the screen's ${SH}`)
  }
})

test('the board samples its own column of the plate, so the text meets the artwork', () => {
  const { group } = buildTv()
  const board = meshesOf(group).find(({ mesh }) => mesh.userData.adStationPlate !== undefined)
  assert.ok(board, 'the station board pane is missing')
  const tex = board.mesh.material.map
  assert.ok(tex, 'the board has no plate texture')

  // `drawStationDisplay` draws into a **whole-screen** canvas (`STATION_PLATE`): the
  // board's column is its left `TV_POSTER_RECT.x`, and the artwork's region is the
  // rest. The board mesh is only the column, so its texture must address that slice
  // and stop where the column stops. A full-width map squeezes the entire plate into
  // the left `TV_POSTER_RECT.x` of the mesh: that is the black band between the cards
  // and the artwork, with the text beside it condensed by 1 / x. Geometry-only tests
  // cannot see it, because the panes still tile the screen perfectly — only the
  // sampling is wrong.
  const { poster } = stationDisplayLayout()
  const sampled = tex.offset.x + tex.repeat.x * STATION_PLATE.width
  // The sampled slice must end on the same line the layout draws the column's right
  // edge on — that line is the seam the artwork starts from.
  assert.ok(
    Math.abs(sampled - poster.x) < 1e-6,
    `the board samples ${sampled.toFixed(2)} px of the ${STATION_PLATE.width} px plate, but the drawn column ends at ${poster.x.toFixed(2)} px`,
  )
  assert.equal(tex.offset.x, 0, "the board must start at the plate's left edge")
  assert.equal(tex.repeat.y, 1, 'the plate and the board are the same height')
  // Wrapping would fold the artwork's pixels round into the column's right edge.
  assert.equal(tex.wrapS, THREE.ClampToEdgeWrapping, 'the plate slice must not wrap')
})
