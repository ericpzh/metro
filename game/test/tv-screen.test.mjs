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
    return Math.abs(size.x - 1.42) < 1e-6 && Math.abs(size.z - 0.8) < 1e-6
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

test('the video overlays the full plate and leaves its bottom footer visible', () => {
  const { group } = buildTv()
  const screen = group.userData.adScreen
  const win = screen.userData.adWindow
  assert.ok(Math.abs(win.w - 1.42 * TV_POSTER_RECT.w) < 1e-6)
  assert.ok(Math.abs(win.h - 0.8 * TV_POSTER_RECT.h) < 1e-6)
  const board = meshesOf(group).find(({mesh}) => mesh.userData.adStationPlate !== undefined)
  const video = meshesOf(group).find(({mesh}) => mesh === screen)
  assert.ok(Math.abs(board.box.max.x - board.box.min.x - 1.42) < 1e-6)
  assert.ok(Math.abs(board.box.max.z - board.box.min.z - 0.8) < 1e-6)
  assert.ok(video.box.min.z > board.box.min.z, 'footer remains below the video')
  assert.ok(Math.abs(video.box.max.z - board.box.max.z) < 1e-6, 'video reaches the top')
  assert.ok(video.box.min.y < board.box.min.y, 'video stands in front, avoiding z-fighting')
  assert.equal(board.mesh.material.map.repeat.x, 1, 'whole-screen station texture keeps the footer full width')
  assert.equal(board.mesh.material.map.repeat.y, 1)
})
