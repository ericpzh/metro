// Glass panels (装饰 玻璃板, §5.7): short sizes clad a wall; the 4 m sizes stand on a floor edge.
//
// Two things make the piece what it is, and both are mechanical rather than
// artistic — which is why they are pinned here rather than checked by eye:
//
//   * **The frame is the outer frame only.** A fence draws a post and a pair of
//     rails *per cell*; a glass panel draws one sill, one head and two end posts
//     around the whole run and **one pane** between them. `module-build` pins the
//     mesh count (five, at every size) and this file pins what those five are.
//   * **It has two mounting modes.** Short panels reserve a slab on the wall and
//     need backing on every course; 4 m panels reserve their full floor-edge cells
//     and do not need a wall. Their geometry and collision envelopes follow suit.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { DEFAULT_GLASS_VARIANT, GLASS_FRAME, GLASS_SPECS, GLASS_VARIANTS, glassSpec, glassStandsOnFloor, glassWallCourses } from '../src/sim/glassPanels.ts'
import {
  autofaceWallMount,
  glassCells,
  isWallMounted,
  moduleAt,
  moduleEnvelope,
  moduleFootprint,
  placementBlocked,
  wallMountCourses,
  wallMountMissing,
  wallSide,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, isGlassType, isWallMountedType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'

const glass = (x, y, z = 0, rot = 0, id = 'glass-1', variant = '1x1') => ({
  id,
  type: 'glass',
  x,
  y,
  z,
  rot,
  w: glassSpec(variant).w,
  cfg: { variant },
})

/**
 * `cells` floor blocks in a row at y = 0, with a wall column behind them at y = 1
 * standing `courses` metres high — the shape every wall-mounted piece is tested
 * against. The wall is at +y, so the piece that hangs on it is turned rot 2.
 */
function walled(courses = 4, cells = 3) {
  const out = []
  for (let x = 0; x < cells; x++) {
    out.push({ x, y: 0, z: 0, fill: 'solid' })
    for (let dz = 1; dz <= courses; dz++) out.push({ x, y: 1, z: dz, fill: 'solid' })
  }
  return out
}

test('nine sizes share one table: wall panels and tall floor-edge panels', () => {
  assert.equal(GLASS_VARIANTS.length, 9, 'six wall sizes and three tall floor-edge sizes')
  assert.deepEqual(
    GLASS_VARIANTS.map((v) => `${GLASS_SPECS[v].w}x${GLASS_SPECS[v].h}`),
    ['1x1', '2x1', '3x1', '1x2', '2x2', '3x2', '2x4', '3x4', '4x4'],
    'the palette reads 1/2/3 cells at 1/2 m and 2/3/4 cells at 4 m',
  )
  // Every palette id is a real size, and every size is in the palette: a tile that
  // names a variant the table does not have is a piece that cannot be built.
  const paletteIds = MODULE_OPTIONS.filter((m) => isGlassType(m.id)).map((m) => m.id)
  assert.deepEqual(paletteIds, GLASS_VARIANTS.filter((v) => !v.endsWith('x4')).map((v) => `glass-${v}`), 'wall sizes stay in the glass submenu')
  for (const v of GLASS_VARIANTS) {
    const spec = glassSpec(v)
    assert.equal(spec.variant, v)
    assert.ok(spec.w >= 1 && spec.w <= 4, `${v}: a panel is one to four cells wide`)
    assert.ok([1, 2, 4].includes(spec.h), `${v}: a panel is 1, 2 or 4 m high`)
    assert.equal(glassStandsOnFloor(spec), spec.h === 4, `${v}: only the 4 m variants stand on a floor edge`)
    assert.ok(spec.label.includes(`${spec.w}×${spec.h}`), `${v}: its label says its size (${spec.label})`)
  }
  assert.equal(glassSpec(undefined).variant, DEFAULT_GLASS_VARIANT, 'a legacy module is the 1 × 1 band')
  assert.equal(glassSpec('nonsense').variant, DEFAULT_GLASS_VARIANT)
})

test('the factory builds a panel of its size, centred on the hovered cell', () => {
  const one = createModule('glass-2x1', 5, 6, 0, 'g1', 0)
  assert.equal(one.type, 'glass')
  assert.equal(one.w, 2)
  assert.deepEqual(one.cfg, { variant: '2x1' })
  // A two-cell panel grows evenly either side of the pointer, like a billboard's
  // run: the pointer names the middle of the window, not its west end.
  assert.ok(one.x <= 5 && one.x + one.w > 5, `a 2-cell run covers the hovered cell (x=${one.x})`)
  // A bare `glass` (an old caller) is the default size, and an id the palette does
  // not offer is refused rather than minted with a size nobody chose.
  assert.deepEqual(createModule('glass', 5, 6, 0, 'g2', 0).cfg, { variant: DEFAULT_GLASS_VARIANT })
  assert.equal(createModule('glass-nonsense', 5, 6, 0, 'g3', 0), null)
  // A **placed** module with a variant this build does not know still draws: the
  // spec table answers with the default, so a save from a later build keeps its wall.
  assert.equal(glassSpec('nonsense').variant, DEFAULT_GLASS_VARIANT)
})

test('short panels reserve the wall slab; tall panels reserve their floor-edge run', () => {
  const band = moduleEnvelope(glass(2, 3, 0, 0, 'g', '2x1'))
  // Flat against the wall at rot 0, which is the local −y face: the thin axis is y,
  // and the housing keeps the wall's own quarter of the cell (`PANEL_DEPTH` in from the
  // wall's face at y = 3), so the room in front of the panel is not the panel's.
  assert.deepEqual([band.x0, band.x1], [2, 4], 'the run is two cells wide')
  assert.ok(Math.abs(band.y0 - 3) < 1e-9 && Math.abs(band.y1 - 3.25) < 1e-9, `the housing hugs the wall (y ${band.y0}–${band.y1})`)
  // It is cladding: the band starts at the floor top and rises the panel's height.
  assert.equal(band.z0, 1, 'the sill sits on the floor')
  assert.equal(band.z1, 2, 'and the head at 1 m for a 1x1')
  const tall = moduleEnvelope(glass(2, 3, 0, 0, 'g', '1x2'))
  assert.equal(tall.z1, 3, 'a 1×2 window reaches 2 m')
  const standing = moduleEnvelope(glass(2, 3, 0, 0, 'g', '3x4'))
  assert.deepEqual([standing.x0, standing.x1, standing.y0, standing.y1, standing.z0, standing.z1], [2, 5, 3, 4, 1, 5], 'the 3×4 panel occupies three full edge cells and four metres of height')
  assert.equal(isWallMounted(glass(2, 3, 0, 0, 'g', '3x4')), false, 'a tall panel does not require a backing wall')
  assert.equal(isWallMounted(glass(2, 3, 0, 0, 'g', '3x2')), true, 'a short panel remains wall-mounted')
  // A quarter-turn swaps which axis is thin, and the run follows it.
  const turned = moduleEnvelope(glass(2, 3, 0, 1, 'g', '2x1'))
  assert.ok(Math.abs(turned.x0 - 2.75) < 1e-9 && Math.abs(turned.x1 - 3) < 1e-9, `rot 1 hugs the +x wall (x ${turned.x0}–${turned.x1})`)
  assert.deepEqual([turned.y0, turned.y1], [3, 5], 'and the run lies on y')
})

test('the run is the panel: every cell of it is the footprint and the base', () => {
  assert.deepEqual(glassCells(glass(2, 3, 0, 0, 'g', '3x1')), [
    [2, 3, 0],
    [3, 3, 0],
    [4, 3, 0],
  ])
  assert.deepEqual(glassCells(glass(2, 3, 0, 1, 'g', '3x1')), [
    [2, 3, 0],
    [2, 4, 0],
    [2, 5, 0],
  ])
  assert.deepEqual(moduleFootprint(glass(2, 3, 0, 0, 'g', '2x1')), [
    [2, 3],
    [3, 3],
  ])
})

test('only short panels need a wall backing every course they cross', () => {
  assert.deepEqual(glassWallCourses(glassSpec('1x1')), [0], 'a 1 m band wants the first course')
  assert.deepEqual(glassWallCourses(glassSpec('3x2')), [0, 1], 'a 2 m window wants two')
  assert.deepEqual(wallMountCourses(glass(0, 0, 0, 2, 'g', '1x2')), [0, 1])

  const floor = walled(0).filter((c) => c.z === 0)
  assert.equal(wallMountMissing(floor, glass(0, 0, 0, 2, 'g', '1x1')), true, 'no wall at all refuses the panel')
  const oneCourse = walled(1)
  assert.equal(wallMountMissing(oneCourse, glass(0, 0, 0, 2, 'g', '1x1')), false, 'a 1 m wall carries the 1 m band')
  assert.equal(wallMountMissing(oneCourse, glass(0, 0, 0, 2, 'g', '1x2')), true, 'and refuses the 2 m window')
  const twoCourses = walled(2)
  assert.equal(wallMountMissing(twoCourses, glass(0, 0, 0, 2, 'g', '1x2')), false, 'two courses carry the window')
  assert.equal(wallMountMissing(floor, glass(0, 0, 0, 2, 'g', '2x4')), false, 'a standing panel needs no backing wall')
  // A multi-cell run needs a wall behind **every** cell of it, or the window hangs
  // off the end of the wall. At rot 2 the run lies along −x from the anchor, so a
  // 2-cell panel anchored at x = 1 covers x = 1 and x = 0.
  const oneCell = walled(2, 1)
  assert.equal(wallMountMissing(oneCell, glass(1, 0, 0, 2, 'g', '2x1')), true, 'a 2-cell panel needs 2 backed cells')
  assert.equal(wallMountMissing(walled(2, 2), glass(1, 0, 0, 2, 'g', '2x1')), false)
  assert.deepEqual(glassCells(glass(1, 0, 0, 2, 'g', '2x1')), [
    [1, 0, 0],
    [0, 0, 0],
  ], 'the run lies along the wall, and −x is that way at rot 2')
})

test('a wall panel turns itself to the wall that backs it', () => {
  // The wall is at +y, so rot 2 is the turn that hangs: the panel is an **output** of
  // the wall, never something R has to be pressed into beforehand.
  const off = glass(0, 0, 0, 0, 'g', '1x1')
  const faced = autofaceWallMount(walled(), off)
  assert.equal(faced.rot, 2, `the panel turns to face its wall (rot ${faced.rot})`)
  assert.deepEqual(wallSide(faced.rot), [0, 1], 'and its wall is the +y neighbour')
  assert.equal(wallMountMissing(walled(), faced), false)
  // A turn that already hangs is kept, so a panel deliberately flipped between two
  // walls is not spun back.
  assert.equal(autofaceWallMount(walled(), glass(0, 0, 0, 2, 'g', '1x1')).rot, 2)
})

test('two panels may not share a cell, and neighbours may not', () => {
  assert.equal(placementBlocked([glass(2, 2, 0, 0, 'a', '1x1')], glass(2, 2, 0, 0, 'b', '1x1')), true)
  assert.equal(placementBlocked([glass(2, 2, 0, 0, 'a', '1x1')], glass(3, 2, 0, 0, 'b', '1x1')), false)
  // A 1 m panel standing on the floor and a bench against the same wall want the
  // same metre of air, so the pair collides — the bench is not "under" the band.
  assert.equal(placementBlocked([glass(2, 2, 0, 0, 'a', '1x1')], { id: 'b', type: 'bench', x: 2, y: 2, z: 0, w: 1, cfg: {} }), true)
})

test('a glass panel is found from its own cell, and the palette files it under 装饰', () => {
  assert.equal(moduleAt([glass(2, 2, 0, 0, 'g', '1x1')], 2, 2, 0)?.id, 'g')
  assert.equal(moduleAt([glass(2, 2, 0, 0, 'g', '2x1')], 3, 2, 0)?.id, 'g', 'found from the far cell of its run')
  assert.equal(moduleAt([glass(2, 2, 0, 0, 'g', '1x1')], 2, 3, 0), undefined)
  for (const v of GLASS_VARIANTS) {
    assert.equal(isGlassType(`glass-${v}`), true)
    assert.equal(isDecorType(`glass-${v}`), true, 'the rail files it under 装饰')
    assert.equal(isWallMountedType(`glass-${v}`), true, 'and its tool is the wall-mounting one')
    assert.equal(moduleLabel('glass'), '玻璃板')
  }
})

test('both pieces round-trip the save', () => {
  const station = {
    name: 't',
    seed: 1,
    cells: walled(),
    modules: [glass(0, 0, 0, 2, 'g1', '2x1'), glass(2, 0, 0, 2, 'g2', '1x2')],
    lines: [],
  }
  const r = parse(serialize(station))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, station.modules)
})

test('a drag sweep takes the same size, and leaves the others', () => {
  assert.equal(sweepFamily(glass(0, 0, 0, 0, 'a', '2x1')), 'glass:2x1')
  assert.equal(sameSweepFamily(glass(0, 0, 0, 0, 'a', '2x1'), glass(1, 0, 0, 3, 'b', '2x1')), true)
  assert.equal(sameSweepFamily(glass(0, 0, 0, 0, 'a', '2x1'), glass(1, 0, 0, 0, 'b', '1x1')), false)
})

test('a different size is a different hover ghost, so the palette click redraws it', () => {
  // The ghost is skipped when its key matches the one already drawn: a size left out
  // of the key would leave a 1 × 1 band under the pointer after picking the 3 × 2.
  assert.notEqual(moduleGhostKey(glass(2, 2, 0, 0, 'a', '1x1')), moduleGhostKey(glass(2, 2, 0, 0, 'b', '3x2')))
  // The cell and the rotation are the key's own, as for every piece.
  assert.notEqual(moduleGhostKey(glass(2, 2, 0, 0, 'a', '1x1')), moduleGhostKey(glass(3, 2, 0, 0, 'a', '1x1')))
})

/* ------------------------------------------------------------------ the model */

/**
 * Build one panel with the lightest context it needs: a lazily minted material per
 * name (so a mesh can be recognised by the material it was handed). The glass builder
 * draws no canvas, so no station and no DOM are involved.
 */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const group = buildModule(mod, { mats, data: { name: 't', seed: 1, cells: [], modules: [], lines: [] }, trackCells: new Set(), finish: () => mats.steel })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  // The module sits at (0, 0, 0): take the cell centre and the block top back off, so
  // every measurement below is in the panel's own frame (0 = the floor top).
  const box = new THREE.Box3().setFromObject(group).translate(new THREE.Vector3(-0.5, -0.5, -1))
  return { mats, meshes, box }
}

test('the frame is an outer frame only, around one pane', () => {
  for (const variant of GLASS_VARIANTS) {
    const spec = glassSpec(variant)
    const { mats, meshes, box } = build(glass(0, 0, 0, 0, 'g', variant))
    // Five meshes at every size: a sill, a head, two end posts and the pane. A
    // mullion at a cell seam would make a 3-cell panel draw seven.
    assert.equal(meshes.length, 5, `${variant}: one outer frame and one pane`)
    const panes = meshes.filter((m) => m.material === mats.glass)
    assert.equal(panes.length, 1, `${variant}: one pane, not one per cell`)
    assert.equal(meshes.filter((m) => m.material === mats.darkSteel).length, 2, `${variant}: the sill and the head`)
    assert.equal(meshes.filter((m) => m.material === mats.steel).length, 2, `${variant}: the two end posts`)

    const { depth, rail, post } = GLASS_FRAME
    // The pane spans the run between the posts, and the frame wraps it: the panel is
    // the size the envelope reserves, so what is drawn is what the wall must carry.
    assert.ok(Math.abs(box.max.z - spec.h) < 1e-6, `${variant}: drawn ${spec.h} m tall, as reserved`)
    assert.ok(Math.abs(box.min.z) < 1e-6, `${variant}: the sill stands on the floor`)
    assert.ok(Math.abs(box.max.x - box.min.x - spec.w) < 1e-6, `${variant}: the run is ${spec.w} cells of ${spec.w} m`)
    assert.ok(Math.abs(box.max.y - box.min.y - depth) < 1e-6, `${variant}: the assembly is one frame deep`)
    if (glassStandsOnFloor(spec)) {
      assert.ok(box.min.y < -0.5 && box.max.y < 0, `${variant}: frame sits along the tile's leading edge`)
    } else {
      // Short panels hang in the half-cell nearest the backing wall.
      assert.ok(box.min.y < -0.4 && box.max.y < -0.3, `${variant}: bolted flat to the −y wall (y ${box.min.y}..${box.max.y})`)
    }
    // The pane is inset by the posts at each end and by the rails top and bottom.
    const pane = panes[0]
    assert.ok(Math.abs(pane.geometry.parameters.width - (spec.w - post * 2)) < 1e-6, `${variant}: the pane stops at the posts`)
    assert.ok(pane.geometry.parameters.height < spec.h - rail, `${variant}: and the rails clear it`)
    assert.equal(pane.userData.glassPane, true, `${variant}: the pane is marked, so a test can find it`)
    // The posts stand at the two ends — nothing anywhere in between.
    const posts = meshes.filter((m) => m.material === mats.steel)
    assert.deepEqual(
      posts.map((m) => Math.round(m.position.x * 1000) / 1000).sort((a, b) => a - b),
      [-(spec.w / 2 - post / 2), spec.w / 2 - post / 2].map((n) => Math.round(n * 1000) / 1000),
      `${variant}: the posts are the run's two ends`,
    )
  }
})

test('a fence of the same length is a row of frames; a glass panel is one', () => {
  // The distinction the piece exists for, as a number: three 1 m fences are three
  // posts and three pairs of rails (27 meshes), where one 3-cell glass panel is five.
  const fence = buildModule(
    { id: 'f', type: 'fence', x: 0, y: 0, z: 0, rot: 0, cfg: {} },
    { mats: new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) }), data: { name: 't', seed: 1, cells: [], modules: [], lines: [] }, trackCells: new Set(), finish: () => null },
  )
  let fences = 0
  fence.traverse((o) => {
    if (o.isMesh) fences++
  })
  const { meshes } = build(glass(0, 0, 0, 0, 'g', '3x1'))
  assert.ok(meshes.length < fences, `one window (${meshes.length} meshes) against one panel of fence (${fences})`)
})
