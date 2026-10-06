// Line system maps (装饰 线网图, §5.7): the network diagram, drawn from the station's
// own lines.
//
// The piece is **generated**, not authored: the picture is a function of
// `StationData.lines`, and the two things that can go wrong quietly are the layout
// and the mount.
//
//   * The layout is arithmetic (which row is where, how many stations fit, which
//     names are interchanges, when labels have to thin out), so it is checked here in
//     Node rather than by looking at a board: a row that prints off the panel, two
//     rows folded onto each other and twenty labels struck through one another all
//     look like "a map" from across the room.
//   * The mount is a contract with the sim: `wall` is a framed board bolted to a wall
//     (backed on every course it crosses, and it may hang over a track where there is
//     no floor), `stand` is a totem on a plinth that reserves its own cell and prints
//     on **both** faces. Neither half may borrow the other's rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as THREE from 'three'
import {
  DEFAULT_LINE_MAP_VARIANT,
  LINE_MAP_ASPECT,
  LINE_MAP_PANEL_H,
  LINE_MAP_PANEL_W,
  LINE_MAP_SPECS,
  LINE_MAP_VARIANTS,
  isStandingLineMap,
  LINE_MAP_FRAME_PAD,
  lineMapSpec,
  lineMapWallCourses,
} from '../src/sim/linemaps.ts'
import {
  autofaceWallMount,
  calligraphyCells,
  isWallMounted,
  lineMapCells,
  moduleAt,
  moduleBlockedCells,
  moduleEnvelope,
  moduleFootprint,
  placementBlocked,
  wallMountCourses,
  wallMountMissing,
} from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, isLineMapType, isWallMountedType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { PX_PER_METRE, drawLineMapPlaceholder, lineMapPlaceholderLayout, lineMapPlaceholderPlate } from '../src/render/lineMapFace.ts'
import { panelUvWindow } from '../src/render/panelUv.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

/* ------------------------------------------------------------------- lines */

const line = (id, name, colour, stations) => ({
  id,
  name,
  colour,
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
  stations,
})

/** Two lines that meet at 公园前 — one interchange, and it is in the middle. */
const LINES = [
  line('2', '2号线', '#00679e', ['广州南站', '会江', '公园前', '纪念堂', '广州火车站']),
  line('5', '5号线', '#a6224a', ['滘口', '公园前', '杨箕', '动物园']),
]

/** `cells` floor blocks at y = 0 with a four-course wall behind them at y = 1. */
function walled(courses = 4, cells = 6) {
  const out = []
  for (let x = 0; x < cells; x++) {
    out.push({ x, y: 0, z: 0, fill: 'solid' })
    for (let dz = 1; dz <= courses; dz++) out.push({ x, y: 1, z: dz, fill: 'solid' })
  }
  return out
}

/** A placed map of a mount, on a wall at +y (rot 2) unless told otherwise. */
function placed(id, rot = 2, x = 2) {
  const doc = toState({ name: '公园前', seed: 1, cells: walled(), modules: [], lines: LINES })
  const mod = createModule(id, x, 0, 0, 'm-' + id, rot, undefined, 'up', 'lane', doc)
  assert.ok(mod, `${id} builds`)
  return mod
}

test('the two mounts are one table: a wall board and a floor totem', () => {
  assert.deepEqual(LINE_MAP_VARIANTS, ['wall', 'stand'])
  assert.equal(LINE_MAP_SPECS.wall.mount, 'wall')
  assert.equal(LINE_MAP_SPECS.wall.doubleSided, false, 'a board on a wall is read from one side')
  assert.equal(LINE_MAP_SPECS.wall.w, 2, 'two cells of wall')
  assert.equal(LINE_MAP_SPECS.stand.mount, 'stand')
  assert.equal(LINE_MAP_SPECS.stand.doubleSided, true, 'the totem prints on both faces')
  assert.equal(LINE_MAP_SPECS.stand.w, 2, 'the totem is the same two-cell board, on the ground')
  for (const v of LINE_MAP_VARIANTS) {
    const spec = lineMapSpec(v)
    assert.equal(spec.variant, v)
    assert.ok(spec.panelW > 1.5 && spec.panelH > 1.5, `${v}: a readable board`)
    assert.ok(spec.panelZ - spec.panelH / 2 > 0.4, `${v}: the board is above the floor`)
    assert.ok(spec.panelZ + spec.panelH / 2 <= spec.height, `${v}: and inside the piece's own envelope`)
    // **One board, one aspect**: the two mounts print the same supplied poster, so a
    // wall map and a concourse totem cannot crop the same artwork differently.
    assert.equal(spec.panelW / spec.panelH, LINE_MAP_ASPECT, `${v}: the panel is cut to the poster's own aspect`)
    assert.equal(spec.panelW, LINE_MAP_PANEL_W)
    assert.equal(spec.panelH, LINE_MAP_PANEL_H)
  }
  assert.equal(LINE_MAP_SPECS.wall.panelW, LINE_MAP_SPECS.stand.panelW, 'the same board')
  assert.equal(LINE_MAP_SPECS.wall.panelH, LINE_MAP_SPECS.stand.panelH)
  assert.ok(LINE_MAP_PANEL_H > 1.7 && LINE_MAP_PANEL_H < 1.9, `a two-cell board, near enough square (${LINE_MAP_PANEL_H.toFixed(3)} m)`)
  assert.equal(isStandingLineMap('stand'), true)
  assert.equal(isStandingLineMap('wall'), false)
  assert.equal(lineMapSpec(undefined).variant, DEFAULT_LINE_MAP_VARIANT)
  assert.equal(lineMapSpec('nonsense').variant, DEFAULT_LINE_MAP_VARIANT)
  assert.deepEqual(MODULE_OPTIONS.filter((m) => isLineMapType(m.id)).map((m) => m.id), ['linemap-wall', 'linemap-stand'])
  assert.equal(isDecorType('linemap-wall'), true)
  assert.equal(moduleLabel('linemap'), '线网图')
})

test('the supplied poster is the asset, and the panel is cut to its own pixels', () => {
  // The map is **artwork**, not a drawing: the file in `src/assets/linemaps/` is the
  // 线网示意图 itself, and the panel's aspect is its aspect — so the poster fills its
  // board without a stretch. The file's header is read here rather than trusted, so
  // replacing the asset with a differently shaped picture fails this test instead of
  // silently cropping the map to a slice.
  const jpeg = readFileSync(new URL('../src/assets/linemaps/network-map.jpg', import.meta.url))
  assert.equal(jpeg[0], 0xff, 'it is a JPEG')
  assert.equal(jpeg[1], 0xd8)
  let i = 2
  let size = null
  while (i < jpeg.length) {
    if (jpeg[i] !== 0xff) {
      i++
      continue
    }
    const marker = jpeg[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { h: jpeg.readUInt16BE(i + 5), w: jpeg.readUInt16BE(i + 7) }
      break
    }
    i += 2 + jpeg.readUInt16BE(i + 2)
  }
  assert.ok(size, 'the asset carries a frame header')
  assert.deepEqual(size, { w: 2048, h: 2047 }, 'the supplied 线网示意图, at its own resolution')
  const imageAspect = size.w / size.h
  assert.equal(LINE_MAP_ASPECT, imageAspect, 'the table records the asset’s own aspect')
  // The crop window is therefore the whole image: `panelUvWindow` of the poster's aspect
  // on the panel's aspect is the identity, so nothing is cut off and nothing is smeared.
  const win = panelUvWindow(imageAspect, LINE_MAP_PANEL_W / LINE_MAP_PANEL_H)
  assert.deepEqual(win, { u0: 0, u1: 1, v0: 0, v1: 1 }, 'the poster fills its board exactly')
  // And the glob the art module reads is the folder the file really lives in.
  assert.equal(readdirSync(new URL('../src/assets/linemaps/', import.meta.url)).includes('network-map.jpg'), true)
})

test('every band, tick and label lands on the panel, in reading order', () => {
  for (const variant of LINE_MAP_VARIANTS) {
    const spec = lineMapSpec(variant)
    const panel = { w: spec.panelW, h: spec.panelH }
    const layout = lineMapPlaceholderLayout(panel, LINES, '公园前')
    assert.equal(layout.rows.length, 2, `${variant}: one band per line`)
    assert.equal(layout.hiddenLines, 0)
    assert.equal(layout.stations, 8, 'eight distinct stations')
    assert.equal(layout.calls, 9, 'nine calls')
    assert.deepEqual(layout.interchanges, ['公园前'], 'the one station two lines call at')
    assert.ok(layout.titleY > 0 && layout.titleY < layout.area.y0, `${variant}: a title block above the plan`)
    assert.ok(layout.footerY > layout.area.y1 && layout.footerY < panel.h, `${variant}: a footer under it`)
    // Rows are laid evenly through the plan, top to bottom, in document order, and
    // never overlap: a band is a line, and two lines that share a row are one line.
    const ys = layout.rows.map((r) => r.y)
    assert.deepEqual([...ys].sort((a, b) => a - b), ys, `${variant}: document order down the panel`)
    assert.ok(layout.rows[0].y > layout.area.y0 && layout.rows[1].y < layout.area.y1)
    assert.ok(ys[1] - ys[0] > layout.rows[0].weight, `${variant}: the bands are clear of each other`)
    for (const row of layout.rows) {
      assert.deepEqual([row.lineId, row.name, row.colour], [row.lineId, row.name, row.colour])
      assert.ok(row.band.x0 > 0 && row.band.x1 < panel.w, `${variant}: the band runs inside the board`)
      assert.ok(row.shield.x >= 0 && row.shield.x + row.shield.w <= row.band.x0, `${variant}: the shield heads the band`)
      assert.ok(row.y - row.weight / 2 > layout.area.y0, `${variant}: the band is inside the plan`)
      assert.ok(row.y + row.labelSize > layout.area.y0 && row.y + row.labelSize < layout.area.y1 + row.labelSize, `${variant}: and so are its labels`)
      // Ticks march along the band in station order, and the interchange is ringed.
      const xs = row.ticks.map((t) => t.x)
      assert.deepEqual([...xs].sort((a, b) => a - b), xs, `${variant}: stations in order`)
      for (const t of row.ticks) assert.ok(t.x >= row.band.x0 - 1e-9 && t.x <= row.band.x1 + 1e-9, `${variant}: ${t.name} is on the band`)
      const shared = row.ticks.filter((t) => t.interchange).map((t) => t.name)
      assert.deepEqual(shared, row.name === '2号线' ? ['公园前'] : ['公园前'], `${variant}: the shared station is marked`)
    }
  }
})

test('a crowded band labels every nth station, never over itself', () => {
  const many = line('1', '1号线', '#f3d03e', Array.from({ length: 24 }, (_, i) => `站${i + 1}`))
  const panel = { w: LINE_MAP_SPECS.stand.panelW, h: LINE_MAP_SPECS.stand.panelH }
  const layout = lineMapPlaceholderLayout(panel, [many], '公园前')
  const row = layout.rows[0]
  assert.equal(row.sparse, true, 'twenty-four names do not fit one 0.9 m board')
  assert.equal(row.ticks.length, 24, 'every station still gets its tick')
  const labelled = row.ticks.filter((t) => t.labelled)
  // A 0.9 m face cannot name twenty-four stations: a handful are named, and every one
  // of them still has its own room.
  assert.ok(labelled.length >= 2 && labelled.length < 24, `the labels thin out (${labelled.length} of 24)`)
  assert.equal(row.ticks[0].labelled, true, 'the first is always labelled')
  // No two labelled names overlap: consecutive labels are a label's own width apart.
  const want = row.labelSize * 1.35
  for (let i = 1; i < labelled.length; i++) {
    assert.ok(labelled[i].x - labelled[i - 1].x >= want, `labels clear each other (${(labelled[i].x - labelled[i - 1].x).toFixed(3)} m for ${row.labelSize.toFixed(3)} m type)`)
  }
  // A board with room for every name labels every name.
  const roomy = lineMapPlaceholderLayout({ w: 8, h: 1.4 }, [many], 't')
  assert.equal(roomy.rows[0].sparse, false, 'eight metres of board holds twenty-four names')
  assert.equal(roomy.rows[0].ticks.filter((t) => t.labelled).length, 24)
})

test('a board taller than the network has room for holds lines back rather than folding them', () => {
  // Twenty lines on a 1.8 m board: each band would be 0.09 m, and a band needs
  // `MIN_ROW` — so the board draws what it can and counts the rest.
  const many = Array.from({ length: 20 }, (_, i) => line(String(i + 1), `${i + 1}号线`, '#c8102e', [`a${i}`, `b${i}`]))
  const layout = lineMapPlaceholderLayout({ w: LINE_MAP_SPECS.stand.panelW, h: LINE_MAP_SPECS.stand.panelH }, many, 't')
  assert.ok(layout.hiddenLines > 0, 'some lines do not fit')
  assert.equal(layout.rows.length + layout.hiddenLines, 20, 'and every line is accounted for')
  assert.ok(layout.rows.length > 0, 'the board is never blank when there is a network')
  for (const row of layout.rows) assert.ok(row.y > layout.area.y0 && row.y < layout.area.y1, 'every drawn band is inside the plan')
  // The wall board is taller, so it holds fewer back.
  const wall = lineMapPlaceholderLayout({ w: LINE_MAP_SPECS.wall.panelW, h: LINE_MAP_SPECS.wall.panelH }, many, 't')
  assert.ok(wall.hiddenLines <= layout.hiddenLines, 'a bigger board holds no more back than a smaller one')
})

test('a station with no lines still gets a board', () => {
  const layout = lineMapPlaceholderLayout({ w: LINE_MAP_PANEL_W, h: LINE_MAP_PANEL_H }, [], '未命名车站')
  assert.deepEqual(layout.rows, [])
  assert.equal(layout.stations, 0)
  assert.equal(layout.station, '未命名车站')
  // And it prints the same words a 电视 with no line does, rather than an empty panel.
  const { g, ops } = stubCanvas(800, 600)
  drawLineMapPlaceholder(g, { lines: [], stationName: '未命名车站', panel: { w: LINE_MAP_PANEL_W, h: LINE_MAP_PANEL_H } })
  assert.ok(ops.texts.includes('尚未铺设线路'), 'an empty board says so')
  assert.ok(ops.texts.includes('线网示意图'), 'and still carries its title')
  assert.ok(ops.filled.length > 0, 'over a real ground, not a transparent panel')
})

test('the factory builds the mount, and the wall board is centred on its run', () => {
  const wall = placed('linemap-wall')
  assert.equal(wall.type, 'linemap')
  assert.deepEqual(wall.cfg, { mount: 'wall' })
  assert.equal(wall.w, 2)
  assert.ok(wall.x <= 2 && wall.x + wall.w > 2, `a 2-cell board covers the hovered cell (x=${wall.x})`)
  const stand = placed('linemap-stand')
  assert.deepEqual(stand.cfg, { mount: 'stand' })
  assert.equal(stand.w, 2, 'the totem is the same two-cell board')
  assert.ok(stand.x <= 2 && stand.x + stand.w > 2, `and covers the hovered cell (x=${stand.x})`)
  assert.deepEqual(createModule('linemap', 2, 0, 0, 'x', 2).cfg, { mount: DEFAULT_LINE_MAP_VARIANT })
  assert.equal(createModule('linemap-nonsense', 2, 0, 0, 'x', 2), null)
})

test('a wall board is a slab on the wall; a totem is a cell on the floor', () => {
  const board = moduleEnvelope(placed('linemap-wall'))
  assert.ok(board.y0 > 0 && board.y1 <= 1, 'the board keeps the wall’s own quarter of the cell, not the room')
  assert.ok(Math.abs(board.y0 - 0.75) < 1e-9 && Math.abs(board.y1 - 1) < 1e-9, `the housing hugs the +y wall (y ${board.y0}–${board.y1})`)
  // Its band is the poster plus the frame's clearance: 1.2 m to the board's bottom in
  // the piece's own frame, so a 座椅 against the same wall keeps its metre of air.
  const spec = LINE_MAP_SPECS.wall
  const bottom = 1 + spec.panelZ - spec.panelH / 2
  assert.ok(
    Math.abs(board.z0 - (bottom - LINE_MAP_FRAME_PAD)) < 1e-9 && Math.abs(board.z1 - (bottom + spec.panelH + LINE_MAP_FRAME_PAD)) < 1e-9,
    `the board's band with its frame (${board.z0}–${board.z1})`,
  )
  assert.ok(board.z1 < 4, 'and it stays under the storey’s ceiling')
  const { x0, x1 } = board
  assert.ok(x1 - x0 >= 2 && x1 - x0 <= 3, 'two cells of run')
  const totem = moduleEnvelope(placed('linemap-stand'))
  assert.deepEqual([totem.x0, totem.y0, totem.x1, totem.y1], [1, 0, 3, 1], 'the totem reserves its whole run (two cells)')
  assert.equal(totem.z0, 1, 'from the floor top')
  assert.equal(totem.z1, 1 + LINE_MAP_SPECS.stand.height, `to its own head (${LINE_MAP_SPECS.stand.height} m)`)
  // A bench against the same wall stands under the board, because the board is not
  // there — this is the whole point of a thin slab on a wall.
  assert.equal(placementBlocked([placed('linemap-wall')], { id: 'b', type: 'bench', x: 2, y: 0, z: 0, w: 1, cfg: {} }), false)
  // The run and the footprint follow the rotation, like every other run: at rot 2 the
  // two cells lie along −x from the anchor.
  assert.deepEqual(lineMapCells(placed('linemap-wall')), [
    [2, 0, 0],
    [1, 0, 0],
  ])
  assert.deepEqual(moduleFootprint(placed('linemap-stand')), [
    [2, 0],
    [1, 0],
  ])
})

test('the wall board bolts to a wall; the totem needs floor and never a wall', () => {
  const board = placed('linemap-wall')
  assert.equal(isWallMounted(board), true)
  assert.equal(wallMountCourses(board).length > 0, true)
  assert.deepEqual(lineMapWallCourses(lineMapSpec('wall')).length > 0, true)
  assert.deepEqual(lineMapWallCourses(lineMapSpec('stand')), [], 'a totem hangs on nothing')
  // The board crosses the wall's 2nd and 3rd courses, like an inscription at eye height.
  assert.deepEqual(wallMountCourses(board), [1, 2])
  assert.equal(wallMountMissing(walled(2), board), true, 'two courses stop below the board')
  assert.equal(wallMountMissing(walled(3), board), false, 'three carry it')
  assert.equal(autofaceWallMount(walled(3), { ...board, rot: 0 }).rot, 2, 'and it turns itself to face the wall')

  // The totem: never refused for its wall, always for its floor.
  const totem = placed('linemap-stand')
  assert.equal(isWallMounted(totem), false)
  assert.equal(wallMountMissing([], totem), false, 'no wall is required of a totem')
  assert.deepEqual(wallMountCourses(totem), [])
  assert.equal(isWallMountedType('linemap-stand'), false, 'and the palette says so before it is placed')
  assert.equal(isWallMountedType('linemap-wall'), true)
  assert.equal(isWallMountedType('linemap'), true, 'a bare id reads as the wall board')
})

test('a totem shares its cell with nothing and blocks the block in it', () => {
  const totem = placed('linemap-stand')
  assert.equal(placementBlocked([totem], { id: 'g', type: 'gate', x: 2, y: 0, z: 0, cfg: { dir: 'both' } }), true)
  assert.equal(placementBlocked([totem], { id: 'g', type: 'gate', x: 3, y: 0, z: 0, cfg: { dir: 'both' } }), false)
  const blocked = moduleBlockedCells([totem], 0)
  assert.equal(blocked.has('2,0,0'), true, 'the block under a totem is the totem’s own cell')
  assert.equal(moduleAt([totem], 2, 0, 0)?.id, 'm-linemap-stand', 'and the totem is found from its cell')
})

test('both mounts round-trip the save, and a sweep keeps them apart', () => {
  const modules = [placed('linemap-wall'), placed('linemap-stand', 2, 5)]
  const r = parse(serialize({ name: '公园前', seed: 1, cells: walled(), modules, lines: LINES }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, modules)
  assert.equal(sweepFamily(placed('linemap-wall')), 'linemap:wall')
  assert.equal(sweepFamily(placed('linemap-stand')), 'linemap:stand')
  assert.equal(sameSweepFamily(placed('linemap-wall'), placed('linemap-wall', 2, 5)), true)
  assert.equal(sameSweepFamily(placed('linemap-wall'), placed('linemap-stand')), false, 'the totems are not wall maps')
})

test('the other mount is a different hover ghost', () => {
  // The ghost is skipped when its key matches the one already drawn, so the mount has
  // to be in it: picking the totem while the wall board is under the pointer would
  // otherwise keep drawing the board.
  assert.notEqual(moduleGhostKey(placed('linemap-wall')), moduleGhostKey(placed('linemap-stand')))
  assert.equal(moduleGhostKey(placed('linemap-wall')), moduleGhostKey(placed('linemap-wall')))
})

/* ---------------------------------------------------------------- the pixels */

test('the board prints the network: a band, a shield and its stations per line', () => {
  const { g, ops } = stubCanvas(800, 600)
  const panel = { w: LINE_MAP_SPECS.wall.panelW, h: LINE_MAP_SPECS.wall.panelH }
  const layout = drawLineMapPlaceholder(g, { lines: LINES, stationName: '公园前', panel })
  assert.equal(layout.rows.length, 2)
  // The title block, and the station's own name in its plate.
  assert.ok(ops.texts.includes('线网示意图'), 'the board says what it is')
  assert.ok(ops.texts.includes('Transport System Map'), 'in both languages')
  assert.ok(ops.texts.includes('公园前站'), 'and names the station it hangs in')
  // Every line's own colour is laid down as a band, and its shield prints its own name
  // — `5号线` stays `5号线`, exactly as 线路 spells it (§6.3).
  assert.ok(ops.stroked.includes('#00679e'), '2号线 has its band')
  assert.ok(ops.stroked.includes('#a6224a'), '5号线 has its band')
  assert.ok(ops.filled.includes('#00679e') && ops.filled.includes('#a6224a'), 'and its shield')
  assert.ok(ops.texts.includes('2号线') && ops.texts.includes('5号线'), 'each shield prints the line’s own name')
  // Every station is named on the board, and the footer counts the network.
  for (const l of LINES) for (const s of l.stations) assert.ok(ops.texts.includes(s), `${s} is printed`)
  assert.ok(ops.texts.some((t) => t.includes('2 条线路')), 'the footer counts the lines')
  // The interchange is an ink ring on the band, and the ground is the board's own.
  assert.ok(ops.filled.includes('#f4f5f1'), 'a pale printed ground, not a transparent panel')
  assert.ok(ops.stroked.includes('#23262b'), 'the ring round the shared station')
})

test('the map is a function of the document: recolour a line and the board follows', () => {
  const panel = { w: LINE_MAP_SPECS.wall.panelW, h: LINE_MAP_SPECS.wall.panelH }
  const recoloured = [{ ...LINES[0], colour: '#00a651', name: '2号线' }, LINES[1]]
  const { g, ops } = stubCanvas(800, 600)
  drawLineMapPlaceholder(g, { lines: recoloured, stationName: '公园前', panel })
  assert.ok(ops.filled.includes('#00a651'), 'the shield wears the new colour')
  assert.equal(ops.filled.includes('#00679e'), false, 'and not the old one')
})

test('the plate is cut to the panel at the face resolution', () => {
  assert.deepEqual(lineMapPlaceholderPlate({ w: 1.9, h: 1.4 }), { width: Math.round(1.9 * PX_PER_METRE), height: Math.round(1.4 * PX_PER_METRE) })
  assert.deepEqual(lineMapPlaceholderPlate({ w: 0, h: 0 }), { width: 64, height: 64 })
  assert.ok(PX_PER_METRE >= 256, 'enough resolution for the labels')
})

/* ----------------------------------------------------------------- the model */

/** Build one map, recording the face the model asked the scene for. */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshBasicMaterial({ name: String(k) })) })
  const asked = []
  const group = buildModule(mod, {
    mats,
    data: { name: '公园前', seed: 1, cells: [], modules: [], lines: LINES },
    trackCells: new Set(),
    finish: () => mats.steel,
    lineMapFace: (id, panel) => {
      asked.push({ id, panel })
      return { material: new THREE.MeshBasicMaterial({ name: 'map' }) }
    },
  })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  group.updateMatrixWorld(true)
  // In the piece's own frame: the cell centre and the block top taken back off.
  const box = new THREE.Box3().setFromObject(group).translate(new THREE.Vector3(-0.5, -0.5, -1))
  return { mats, meshes, asked, box }
}

/** The world normal of a plane mesh. */
function normalOf(mesh) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()))
}

test('the wall board hangs one lit face on the wall', () => {
  const mod = placed('linemap-wall')
  const { meshes, asked } = build(mod)
  assert.equal(asked.length, 1, 'one plate for the piece')
  assert.deepEqual(asked[0].panel, { w: LINE_MAP_SPECS.wall.panelW, h: LINE_MAP_SPECS.wall.panelH })
  assert.equal(asked[0].id, mod.id)
  // A housing, a steel edge and the lit face.
  assert.equal(meshes.length, 3)
  const faces = meshes.filter((m) => m.geometry.type === 'PlaneGeometry')
  assert.equal(faces.length, 1, 'a board on a wall is read from one side')
  assert.equal(faces[0].userData.lineMapFace, 'front')
  assert.ok(normalOf(faces[0]).y < -0.99, 'facing away from the wall it is bolted to, into the room')
  const glass = new THREE.Box3().setFromObject(faces[0]).getSize(new THREE.Vector3())
  assert.ok(Math.abs(glass.z - LINE_MAP_SPECS.wall.panelH) < 1e-6, 'the face is the panel it reserved')
})

test('the totem prints the map on both faces, off one texture', () => {
  const mod = placed('linemap-stand')
  const { mats, meshes, asked, box } = build(mod)
  // A plinth, a post, the board's body and a face each side.
  assert.equal(meshes.length, 5)
  assert.equal(asked.length, 1, 'the two faces are one map, so the scene mints one plate')
  const faces = meshes.filter((m) => m.geometry.type === 'PlaneGeometry')
  assert.equal(faces.length, 2, 'both faces are lit')
  assert.deepEqual(faces.map((f) => f.userData.lineMapFace).sort(), ['back', 'front'])
  // The two faces look **opposite** ways, each its own plane turned to its own side
  // (`plate`): a single double-sided plane would print the map mirrored on the back.
  const normals = faces.map(normalOf)
  assert.ok(normals.some((n) => n.y > 0.99), 'one face looks one way')
  assert.ok(normals.some((n) => n.y < -0.99), 'and the other the opposite way')
  for (const f of faces) assert.equal(f.material.name, 'map', 'both wear a map material')
  assert.equal(faces[0].material, faces[1].material, 'one texture, two planes')
  // The plinth is what stands on the floor, and the whole piece fits the cell and the
  // 1.9 m head its envelope reserves.
  const plinth = meshes.filter((m) => m.material === mats.darkSteel)
  assert.equal(plinth.length, 2, 'a plinth and the board’s body')
  assert.ok(plinth.some((m) => Math.abs(m.position.z - 0.035) < 1e-9), 'the plinth is on the floor')
  assert.ok(box.min.z > -1e-6 && box.max.z <= LINE_MAP_SPECS.stand.height + 1e-6, `drawn inside its own head (${box.max.z} m)`)
  assert.ok(box.max.x - box.min.x <= 2 && box.max.y - box.min.y <= 1, 'and inside its own two-cell run')
})

test('a ctx with no scene behind it still draws a board', () => {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshBasicMaterial({ name: String(k) })) })
  let meshes = 0
  const group = buildModule(placed('linemap-stand'), {
    mats,
    data: { name: '公园前', seed: 1, cells: [], modules: [], lines: [] },
    trackCells: new Set(),
    finish: () => mats.steel,
  })
  group.traverse((o) => {
    if (o.isMesh) meshes++
  })
  assert.equal(meshes, 5, 'the kit’s own empty board is the fallback')
})

/**
 * The scene's own map cache, driven the way `ModuleSystem` drives it. Before the
 * poster's pixels land a map prints the drawn placeholder it owns; once
 * `lineMaps.ready()` is true it prints the shared art face instead — and a
 * placeholder left in the cache past that moment would keep the drawn board on the
 * wall for the session, so retaining evicts it.
 */
async function mapPlateRig(name, mod, art) {
  const canvases = []
  const saved = globalThis.document
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') return { style: {}, appendChild: () => {}, setAttribute: () => {} }
      const { g, ops } = stubCanvas()
      const c = { width: 0, height: 0, ops, getContext: () => g, toDataURL: () => 'data:,' }
      g.canvas = c
      canvases.push(c)
      return c
    },
  }
  const { PlateSystem } = await import('../src/render/scene/systems/PlateSystem.ts')
  const data = { name, seed: 1, cells: [], modules: [mod], lines: LINES }
  const ctx = { stationData: data, lineMaps: art ?? null }
  const plates = new PlateSystem(ctx)
  return { plates, data, ctx, canvases, restore: () => { globalThis.document = saved } }
}

const mapPanel = () => ({ w: LINE_MAP_SPECS.wall.panelW, h: LINE_MAP_SPECS.wall.panelH })

test('a map prints its placeholder until the poster lands, then the shared art', async () => {
  const mod = placed('linemap-wall')
  const { plates, data, ctx, canvases, restore } = await mapPlateRig('公园前', mod)
  try {
    const panel = mapPanel()
    const first = plates.makeLineMapPlate(mod.id, panel)
    assert.ok(first.texture, 'the placeholder is pixels the plate minted, so it can be repainted')
    assert.equal(plates.decorPlates.get(`${mod.id}|linemap|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`).owned, true)
    assert.equal(plates.makeLineMapPlate(mod.id, panel).material, first.material, 'the same piece and panel hands back the same face')
    assert.equal(canvases.length, 1, 'one allocation for the board')

    // The poster lands: the next face for a new piece is the art's shared one,
    // which this system neither mints nor frees.
    const shared = {
      material: new THREE.MeshBasicMaterial({ name: 'network-map' }),
      geometry: new THREE.PlaneGeometry(panel.w, panel.h),
    }
    shared.material.dispose = () => { throw new Error('the plate cache must never dispose shared art') }
    ctx.lineMaps = { ready: () => true, face: () => shared }
    const other = { ...placed('linemap-wall', 2, 4), id: 'm-linemap-far' }
    data.modules.push(other)
    const art = plates.makeLineMapPlate(other.id, panel)
    assert.equal(art.material, shared.material, 'the totem and the board print one poster')
    assert.equal(plates.decorPlates.get(`${other.id}|linemap|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`).owned, false)

    // …and the placeholder the wall already held is evicted on retain, so the wall
    // reprints artwork on the next rebuild instead of keeping its drawn board.
    plates.retainDecorPlates(data)
    assert.equal(plates.decorPlates.has(`${mod.id}|linemap|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`), false, 'the stale placeholder is dropped once the poster is in hand')
    assert.equal(plates.decorPlates.has(`${other.id}|linemap|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`), true, 'the shared face is kept')
  } finally {
    restore()
  }
})

test('a line edit repaints the placeholder map in place', async () => {
  const mod = placed('linemap-wall')
  const { plates, data, canvases, restore } = await mapPlateRig('公园前', mod)
  try {
    const panel = mapPanel()
    const face = plates.makeLineMapPlate(mod.id, panel)
    assert.equal(canvases.length, 1)
    const version = face.texture.version
    data.lines = [line('1', '1号线', '#e4002b', ['广州东站', '体育西路', '公园前'])]
    plates.redrawDecorPlates()
    assert.ok(face.texture.version > version, 'the board repaints from the live document')
    assert.equal(canvases.length, 1, 'in place: the allocation is kept, not re-minted')
    plates.retainDecorPlates({ ...data, modules: [] })
    assert.equal(plates.decorPlates.size, 0, 'a piece the document no longer holds releases its plate')
  } finally {
    restore()
  }
})
